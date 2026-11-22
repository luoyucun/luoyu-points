// routes/scores.js
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin, requireEdit } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `tmp_${Date.now()}_${Math.random().toString(36).slice(2,6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// GET /api/scores
router.get('/', authMiddleware, async (req, res) => {
  const { villager_id, villager_name, group_no, status, page = 1, limit = 50 } = req.query;
  let sql = `
    SELECT sr.id, sr.villager_id, v.name AS villager_name, v.group_no,
           sr.event_id, sr.event_name, sr.points, sr.description,
           sr.image_urls, sr.status, sr.is_revoked, sr.submitted_by,
           a.name AS submitted_by_name, sr.created_at
    FROM score_records sr
    JOIN villagers v ON v.id = sr.villager_id
    JOIN admins a ON a.id = sr.submitted_by
    WHERE 1=1
  `;
  const params = [];
  if (villager_id)   { sql += ' AND sr.villager_id=?';  params.push(villager_id); }
  if (villager_name) { sql += ' AND v.name LIKE ?';      params.push('%' + villager_name + '%'); }
  if (group_no)      { sql += ' AND v.group_no=?';       params.push(group_no); }
  if (status)        { sql += ' AND sr.status=?';         params.push(status); }
  if (req.admin.role === 'group_leader') {
    sql += ' AND v.group_no=?'; params.push(req.admin.group_no);
  }
  // 总条数
  let countSql2 = 'SELECT COUNT(*) AS total FROM score_records sr JOIN villagers v ON v.id=sr.villager_id WHERE 1=1';
  const countParams2 = [];
  if (villager_id)   { countSql2 += ' AND sr.villager_id=?';  countParams2.push(villager_id); }
  if (villager_name) { countSql2 += ' AND v.name LIKE ?';      countParams2.push('%' + villager_name + '%'); }
  if (group_no)      { countSql2 += ' AND v.group_no=?';       countParams2.push(group_no); }
  if (status)        { countSql2 += ' AND sr.status=?';         countParams2.push(status); }
  if (req.admin.role === 'group_leader') {
    countSql2 += ' AND v.group_no=?'; countParams2.push(req.admin.group_no);
  }
  const [[{ total }]] = await db.execute(countSql2, countParams2);
  sql += ' ORDER BY sr.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  const [rows] = await db.execute(sql, params);
  rows.forEach(r => { if (r.image_urls) { try { r.image_urls = JSON.parse(r.image_urls); } catch(e) { r.image_urls = [r.image_urls]; } } });
  res.json({ code: 0, data: rows, total });
});

// GET /api/scores/public
router.get('/public', async (req, res) => {
  const { limit = 50 } = req.query;
  const [rows] = await db.execute(`
    SELECT sr.id, v.name AS villager_name, v.group_no,
           sr.event_name, sr.points, sr.description, sr.image_urls, sr.status, sr.is_revoked, sr.created_at
    FROM score_records sr
    JOIN villagers v ON v.id = sr.villager_id
    WHERE sr.status = 'approved' AND sr.is_revoked = 0 AND sr.show_in_feed = 1
    ORDER BY sr.created_at DESC LIMIT ?
  `, [parseInt(limit)]);
  rows.forEach(r => { if (r.image_urls) { try { r.image_urls = JSON.parse(r.image_urls); } catch(e) { r.image_urls = [r.image_urls]; } } });
  res.json({ code: 0, data: rows });
});

// GET /api/scores/stats
router.get('/stats', authMiddleware, async (req, res) => {
  const [rows] = await db.execute(`
    SELECT COALESCE(SUM(points),0) AS total_score,
      SUM(CASE WHEN MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW()) THEN points ELSE 0 END) AS month_score
    FROM score_records WHERE submitted_by=? AND status='approved'
  `, [req.admin.id]);
  res.json({ code: 0, data: { summary: rows[0] } });
});

// GET /api/scores/events
router.get('/events', authMiddleware, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM score_events WHERE is_active=1 ORDER BY category, sort_order');
  rows.forEach(r => { if (r.image_urls) { try { r.image_urls = JSON.parse(r.image_urls); } catch(e) { r.image_urls = [r.image_urls]; } } });
  res.json({ code: 0, data: rows });
});

// GET /api/scores/events/public
router.get('/events/public', async (req, res) => {
  const [rows] = await db.execute('SELECT id,name,category,points,verify_method FROM score_events WHERE is_active=1 ORDER BY category, sort_order');
  res.json({ code: 0, data: rows });
});

// PATCH /api/scores/:id/review — 审核（同步更新双积分）
router.patch('/:id/review', authMiddleware, requireVillageAdmin, requireEdit, async (req, res) => {
  const approved = req.body.approved === true || req.body.approved === 'true';
  const status = approved ? 'approved' : 'rejected';
  const [rows] = await db.execute('SELECT * FROM score_records WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ code: 404, message: '记录不存在' });
  const rec = rows[0];
  if (rec.status !== 'pending') return res.status(400).json({ code: 400, message: '该记录已审核' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE score_records SET status=? WHERE id=?', [status, req.params.id]);
    if (approved) {
      // 同时更新兑换积分和荣誉积分
      await conn.execute(
        'UPDATE villagers SET total_score=total_score+?, honor_score=honor_score+? WHERE id=?',
        [rec.points, rec.points, rec.villager_id]
      );
    }
    await conn.commit();
    res.json({ code: 0, message: approved ? '审核通过' : '已拒绝' });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
});

// POST /api/scores — 提交积分（同步更新双积分）
router.post('/', authMiddleware, requireEdit, upload.array('images', 4), async (req, res) => {
  const { villager_id, event_id, description, custom, custom_points, custom_name } = req.body;
  if (!villager_id) return res.status(400).json({ code: 400, message: 'villager_id 必填' });

  const isCustom = custom === 'true';
  if (isCustom) {
    if (!custom_name || !custom_name.trim())
      return res.status(400).json({ code: 400, message: '自定义积分必须填写原因说明' });
    const pts = parseInt(custom_points);
    if (isNaN(pts) || pts === 0) return res.status(400).json({ code: 400, message: '积分值不能为0' });
    if (Math.abs(pts) > 100) return res.status(400).json({ code: 400, message: '单次自定义积分不能超过100分' });
  } else {
    if (!event_id) return res.status(400).json({ code: 400, message: 'event_id 必填' });
  }

  let evt = null;
  if (!isCustom) {
    const [evRows] = await db.execute('SELECT * FROM score_events WHERE id=? AND is_active=1', [event_id]);
    if (!evRows.length) return res.status(400).json({ code: 400, message: '积分事件不存在' });
    evt = evRows[0];
  }

  const finalPoints  = isCustom ? parseInt(custom_points) : evt.points;
  const finalName    = isCustom ? custom_name.trim() : evt.name;
  const finalEventId = isCustom ? null : event_id;
  const finalDesc    = isCustom ? null : (description || null);
  const status = (!isCustom && ['super','village_admin'].includes(req.admin.role)) ? 'approved' : 'pending';

  let imageUrls = [];
  if (req.files && req.files.length) {
    const vid = villager_id.toString().slice(0, 8);
    const evtSlug = finalName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').slice(0, 10) || 'score';
    const renamedFiles = req.files.map(f => {
      const ext = path.extname(f.filename);
      const newName = `v${vid}_${evtSlug}_${Date.now()}_${Math.random().toString(36).slice(2,4)}${ext}`;
      const oldPath = path.join(UPLOAD_DIR, f.filename);
      const newPath = path.join(UPLOAD_DIR, newName);
      try { fs.renameSync(oldPath, newPath); } catch(e) {}
      return fs.existsSync(newPath) ? newName : f.filename;
    });
    imageUrls = renamedFiles.map(name => `/uploads/${name}`);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      `INSERT INTO score_records (villager_id, event_id, event_name, points, description, image_urls, submitted_by, status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [villager_id, finalEventId, finalName, finalPoints, finalDesc,
       imageUrls.length ? JSON.stringify(imageUrls) : null, req.admin.id, status]
    );
    if (status === 'approved') {
      // 同时更新兑换积分和荣誉积分
      await conn.execute(
        'UPDATE villagers SET total_score=total_score+?, honor_score=honor_score+? WHERE id=?',
        [finalPoints, finalPoints, villager_id]
      );
    }
    await conn.commit();
    res.json({ code: 0, message: status==='approved'?'录入成功，积分已生效':'提交成功，等待审核', data: { id: ins.insertId, status } });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
});

// PUT /api/scores/:id — 编辑积分记录（2026-11-23 用户需求：动态生成后只能看不能改）
// 可改：事件名 / 分值 / 说明 / 是否展示在动态；可追加图片（multipart 时）
// 关键：已通过且未撤回的记录改分值时，必须同步调整该村民的兑换积分与荣誉积分（增量）
router.put('/:id', authMiddleware, requireVillageAdmin, upload.array('images', 4), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ code: 400, message: '记录 id 不合法' });
  const [rows] = await db.execute('SELECT * FROM score_records WHERE id=?', [id]);
  if (!rows.length) return res.status(404).json({ code: 404, message: '记录不存在' });
  const old = rows[0];
  if (old.is_revoked) return res.status(400).json({ code: 400, message: '已撤回的记录不能编辑' });

  const b = req.body || {};
  const eventName = b.event_name !== undefined ? String(b.event_name).trim().slice(0, 50) : old.event_name;
  if (!eventName) return res.status(400).json({ code: 400, message: '事件名称不能为空' });

  let points = old.points;
  if (b.points !== undefined && b.points !== '') {
    points = parseInt(b.points, 10);
    if (isNaN(points) || points === 0) return res.status(400).json({ code: 400, message: '分值必须是非零整数' });
    if (Math.abs(points) > 100) return res.status(400).json({ code: 400, message: '单次积分不能超过 100 分' });
  }
  const description = b.description !== undefined ? (String(b.description).trim().slice(0, 500) || null) : old.description;
  let showInFeed = old.show_in_feed;
  if (b.show_in_feed !== undefined) showInFeed = (b.show_in_feed === '1' || b.show_in_feed === 1 || b.show_in_feed === true) ? 1 : 0;

  // 追加图片（保留原有）
  let imageUrls = [];
  try { imageUrls = old.image_urls ? (typeof old.image_urls === 'string' ? JSON.parse(old.image_urls) : old.image_urls) : []; } catch (e) { imageUrls = []; }
  if (!Array.isArray(imageUrls)) imageUrls = [];
  if (req.files && req.files.length) {
    const added = req.files.map(f => {
      const ext = path.extname(f.filename);
      const newName = 'v' + String(old.villager_id).slice(0, 8) + '_edit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 4) + ext;
      try { fs.renameSync(path.join(UPLOAD_DIR, f.filename), path.join(UPLOAD_DIR, newName)); return '/uploads/' + newName; }
      catch (e) { return '/uploads/' + f.filename; }
    });
    imageUrls = imageUrls.concat(added).slice(0, 4);
  }

  const delta = points - old.points;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE score_records SET event_name=?, points=?, description=?, show_in_feed=?, image_urls=? WHERE id=?',
      [eventName, points, description, showInFeed, imageUrls.length ? JSON.stringify(imageUrls) : null, id]
    );
    // 已生效的记录改分值 → 村民积分同步增减
    if (old.status === 'approved' && delta !== 0) {
      await conn.execute(
        'UPDATE villagers SET total_score=total_score+?, honor_score=honor_score+? WHERE id=?',
        [delta, delta, old.villager_id]
      );
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  console.log('[SCORE EDIT] id=' + id + ' by=' + (req.admin && req.admin.username) + ' points ' + old.points + '→' + points + ' delta=' + delta);
  res.json({ code: 0, message: delta ? ('已保存，积分同步调整 ' + (delta > 0 ? '+' : '') + delta) : '已保存' });
});

module.exports = router;

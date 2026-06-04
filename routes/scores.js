// routes/scores.js
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

// 本地存储配置
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `score_${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 前端已压缩，后端放宽到10M
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// GET /api/scores — 积分记录列表
router.get('/', authMiddleware, async (req, res) => {
  const { villager_id, status, page = 1, limit = 50 } = req.query;
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
  if (villager_id) { sql += ' AND sr.villager_id=?'; params.push(villager_id); }
  if (status)      { sql += ' AND sr.status=?';      params.push(status); }
  if (req.admin.role === 'group_leader') {
    sql += ' AND v.group_no=?'; params.push(req.admin.group_no);
  }
  sql += ' ORDER BY sr.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  const [rows] = await db.execute(sql, params);
  rows.forEach(r => { if (r.image_urls) r.image_urls = JSON.parse(r.image_urls); });
  res.json({ code: 0, data: rows });
});

// GET /api/scores/public — 公开积分记录（无需登录，村民查看全村动态）
router.get('/public', async (req, res) => {
  const { limit = 50, status = 'approved' } = req.query;
  const [rows] = await db.execute(`
    SELECT sr.id, v.name AS villager_name, v.group_no,
           sr.event_name, sr.points, sr.description, sr.created_at
    FROM score_records sr
    JOIN villagers v ON v.id = sr.villager_id
    WHERE sr.status = 'approved' AND sr.is_revoked = 0
    ORDER BY sr.created_at DESC LIMIT ?
  `, [parseInt(limit)]);
  res.json({ code: 0, data: rows });
});

// GET /api/scores/stats — 当前登录者积分统计
router.get('/stats', authMiddleware, async (req, res) => {
  const [rows] = await db.execute(`
    SELECT COALESCE(SUM(points),0) AS total_score,
      SUM(CASE WHEN MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW()) THEN points ELSE 0 END) AS month_score
    FROM score_records WHERE submitted_by=? AND status='approved'
  `, [req.admin.id]);
  res.json({ code: 0, data: { summary: rows[0] } });
});

// GET /api/scores/events — 积分事件列表
router.get('/events', authMiddleware, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM score_events WHERE is_active=1 ORDER BY category, sort_order');
  res.json({ code: 0, data: rows });
});

// GET /api/scores/events/public — 积分细则（无需登录）
router.get('/events/public', async (req, res) => {
  const [rows] = await db.execute('SELECT id,name,category,points,verify_method FROM score_events WHERE is_active=1 ORDER BY category, sort_order');
  res.json({ code: 0, data: rows });
});

// PATCH /api/scores/:id/review — 审核积分
router.patch('/:id/review', authMiddleware, requireVillageAdmin, async (req, res) => {
  // 兼容布尔值 true/false 和字符串 "true"/"false"
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
      await conn.execute('UPDATE villagers SET total_score=total_score+? WHERE id=?', [rec.points, rec.villager_id]);
    }
    await conn.commit();
    res.json({ code: 0, message: approved ? '审核通过' : '已拒绝' });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
});

// POST /api/scores — 提交积分
router.post('/', authMiddleware, upload.array('images', 4), async (req, res) => {
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

  // 保存图片路径
  let imageUrls = [];
  if (req.files && req.files.length) {
    imageUrls = req.files.map(f => `/uploads/${f.filename}`);
  }

  const finalPoints  = isCustom ? parseInt(custom_points) : evt.points;
  const finalName    = isCustom ? custom_name.trim() : evt.name;
  const finalEventId = isCustom ? null : event_id;
  const finalDesc    = isCustom ? null : (description || null);
  const status = (!isCustom && ['super','village_admin'].includes(req.admin.role)) ? 'approved' : 'pending';

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
      await conn.execute('UPDATE villagers SET total_score=total_score+? WHERE id=?', [finalPoints, villager_id]);
    }
    await conn.commit();
    res.json({ code: 0, message: status==='approved'?'录入成功，积分已生效':'提交成功，等待审核', data: { id: ins.insertId, status } });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
});

module.exports = router;

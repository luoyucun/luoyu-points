// routes/admin.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin, requireSuper } = require('../middleware/auth');

// Express 4 不自动捕获 async 路由异常
// wrap 确保任何 await 抛出的错误都传给全局错误处理器，返回 500 而不是挂起
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// GET /api/admin/groups
router.get('/groups', authMiddleware, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT DISTINCT group_no FROM villagers WHERE is_active=1 AND group_no IS NOT NULL ORDER BY group_no'
  );
  res.json({ code: 0, data: rows.map(r => r.group_no) });
}));

// GET /api/admin/dashboard
router.get('/dashboard', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [[{ total_villagers }]] = await db.execute('SELECT COUNT(*) AS total_villagers FROM villagers WHERE is_active=1');
  const [[{ total_score }]]    = await db.execute('SELECT COALESCE(SUM(total_score),0) AS total_score FROM villagers WHERE is_active=1');
  const [[{ month_records }]]  = await db.execute(`SELECT COUNT(*) AS month_records FROM score_records WHERE status='approved' AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())`);
  const [[{ pending }]]        = await db.execute(`SELECT COUNT(*) AS pending FROM score_records WHERE status='pending'`);
  const [[{ month_points }]]   = await db.execute(`SELECT COALESCE(SUM(points),0) AS month_points FROM score_records WHERE status='approved' AND points>0 AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())`);
  const [goods_stock]          = await db.execute('SELECT id, name, stock FROM goods WHERE is_active=1 ORDER BY stock ASC');
  const [group_stats]          = await db.execute(`
    SELECT group_no, COUNT(*) AS cnt, COALESCE(SUM(total_score),0) AS total
    FROM villagers WHERE is_active=1 GROUP BY group_no ORDER BY total DESC
  `);
  res.json({ code: 0, data: { total_villagers, total_score, month_records, pending, month_points, goods_stock, group_stats }});
}));

// PATCH /api/admin/scores/:id/revoke
router.patch('/scores/:id/revoke', authMiddleware, requireSuper, wrap(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) return res.status(400).json({ code: 400, message: '撤回原因不能为空' });
  const [rows] = await db.execute('SELECT * FROM score_records WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ code: 404, message: '记录不存在' });
  const rec = rows[0];
  if (rec.is_revoked) return res.status(400).json({ code: 400, message: '该记录已撤回' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'UPDATE score_records SET is_revoked=1, revoked_by=?, revoked_at=NOW(), revoke_reason=? WHERE id=?',
      [req.admin.id, reason.trim(), req.params.id]
    );
    if (rec.status === 'approved') {
      await conn.execute(
        'UPDATE villagers SET total_score=total_score-?, honor_score=honor_score-? WHERE id=?',
        [rec.points, rec.points, rec.villager_id]
      );
    }
    await conn.commit();
    res.json({ code: 0, message: '撤回成功，积分已回退' });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// POST /api/admin/goods
router.post('/goods', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { name, icon, points_cost, stock } = req.body;
  if (!name || !points_cost) return res.status(400).json({ code: 400, message: '名称和积分为必填' });
  const [rows] = await db.execute('SELECT MAX(sort_order) AS max_order FROM goods');
  const nextOrder = (rows[0].max_order || 0) + 1;
  const [result] = await db.execute(
    'INSERT INTO goods (name, icon, points_cost, stock, is_active, sort_order) VALUES (?,?,?,?,1,?)',
    [name.trim(), icon||'📦', parseInt(points_cost), parseInt(stock)||0, nextOrder]
  );
  res.json({ code: 0, message: '物资添加成功', data: { id: result.insertId } });
}));

// PUT /api/admin/goods/:id
router.put('/goods/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { name, icon, points_cost, stock } = req.body;
  if (!name || !points_cost) return res.status(400).json({ code: 400, message: '名称和积分为必填' });
  await db.execute(
    'UPDATE goods SET name=?, icon=?, points_cost=?, stock=? WHERE id=?',
    [name.trim(), icon||'📦', parseInt(points_cost), parseInt(stock)||0, req.params.id]
  );
  res.json({ code: 0, message: '物资已更新' });
}));

// PATCH /api/admin/goods/:id/stock
router.patch('/goods/:id/stock', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { stock } = req.body;
  if (stock === undefined || stock < 0) return res.status(400).json({ code: 400, message: '库存数量不能为负数' });
  await db.execute('UPDATE goods SET stock=? WHERE id=?', [parseInt(stock), req.params.id]);
  res.json({ code: 0, message: '库存已更新' });
}));

// GET /api/admin/exchange/records
router.get('/exchange/records', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { status, page=1, limit=20 } = req.query;
  let sql = `
    SELECT er.id, er.villager_id, v.name AS villager_name, v.group_no,
           er.goods_name, er.points_cost, er.status, er.created_at
    FROM exchange_records er JOIN villagers v ON v.id = er.villager_id WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND er.status=?'; params.push(status); }
  sql += ' ORDER BY er.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  const [rows] = await db.execute(sql, params);
  const [[{ total }]] = await db.execute(
    `SELECT COUNT(*) AS total FROM exchange_records er JOIN villagers v ON v.id=er.villager_id WHERE 1=1${status?' AND er.status=?':''}`,
    status?[status]:[]
  );
  res.json({ code: 0, data: rows, total });
}));

// PATCH /api/admin/exchange/:id/deliver
router.patch('/exchange/:id/deliver', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [result] = await db.execute(
    'UPDATE exchange_records SET status=? WHERE id=?', ['done', req.params.id]
  );
  if (result.affectedRows === 0)
    return res.status(404).json({ code: 404, message: '兑换记录不存在' });
  res.json({ code: 0, message: '已确认发放' });
}));

// GET /api/admin/export/villagers
router.get('/export/villagers', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { group_no } = req.query;
  let sql = `
    SELECT v.name, v.gender, v.group_no, v.id_last4,
           v.total_score AS exchange_score, v.honor_score,
      (SELECT COALESCE(SUM(points),0) FROM score_records WHERE villager_id=v.id AND status='approved' AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score,
      (SELECT COUNT(*) FROM score_records WHERE villager_id=v.id AND status='approved') AS record_count
    FROM villagers v WHERE v.is_active=1
  `;
  const params = [];
  if (group_no) { sql += ' AND v.group_no=?'; params.push(group_no); }
  sql += ' ORDER BY v.group_no, v.total_score DESC';
  const [rows] = await db.execute(sql, params);
  res.json({ code: 0, data: rows });
}));

// GET /api/admin/export/scores
router.get('/export/scores', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { start_date, end_date, group_no } = req.query;
  let sql = `
    SELECT v.name AS villager_name, v.group_no, sr.event_name, sr.points,
           sr.description, sr.status, sr.is_revoked, sr.created_at, a.name AS submitted_by
    FROM score_records sr
    JOIN villagers v ON v.id=sr.villager_id
    JOIN admins a ON a.id=sr.submitted_by WHERE 1=1
  `;
  const params = [];
  if (start_date) { sql += ' AND DATE(sr.created_at) >= ?'; params.push(start_date); }
  if (end_date)   { sql += ' AND DATE(sr.created_at) <= ?'; params.push(end_date); }
  if (group_no)   { sql += ' AND v.group_no = ?'; params.push(group_no); }
  sql += ' ORDER BY sr.created_at DESC LIMIT 5000';
  const [rows] = await db.execute(sql, params);
  res.json({ code: 0, data: rows });
}));

// PATCH /api/admin/admins/:id/reset-password
router.patch('/admins/:id/reset-password', authMiddleware, requireSuper, wrap(async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ code: 400, message: '密码不能少于8位' });
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(new_password, 10);
  await db.execute('UPDATE admins SET password=? WHERE id=?', [hash, req.params.id]);
  res.json({ code: 0, message: '密码重置成功' });
}));

// GET /api/admin/announcements（后台，含已撤回）
router.get('/announcements', authMiddleware, requireSuper, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id,title,content,tag_type,image_urls,audio_url,audio_type,is_active,created_at FROM announcements ORDER BY created_at DESC'
  );
  rows.forEach(r => {
    if (r.image_urls) { try { r.image_urls = JSON.parse(r.image_urls); } catch(e) { r.image_urls = []; } }
    else r.image_urls = [];
  });
  res.json({ code: 0, data: rows });
}));

// ── 公告富媒体接口 ──
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// shared upload dir for batch scores
const UPLOAD_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2,6) + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const NOTICE_UPLOAD_DIR = path.join(__dirname, '../uploads/notices');
if (!fs.existsSync(NOTICE_UPLOAD_DIR)) fs.mkdirSync(NOTICE_UPLOAD_DIR, { recursive: true });

const noticeUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, NOTICE_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || (file.mimetype.startsWith('audio') ? '.webm' : '.jpg');
      cb(null, `notice_${Date.now()}_${Math.random().toString(36).slice(2,5)}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// POST /api/admin/announcements（发布公告）
router.post('/announcements', authMiddleware, requireSuper,
  noticeUpload.fields([{ name: 'images', maxCount: 9 }, { name: 'audio', maxCount: 1 }]),
  wrap(async (req, res) => {
    const { title, content, tag_type, audio_type } = req.body;
    if (!title || !content) return res.status(400).json({ code: 400, message: '标题和内容不能为空' });
    let image_urls = null;
    if (req.files && req.files.images && req.files.images.length) {
      image_urls = JSON.stringify(req.files.images.map(f => `/uploads/notices/${f.filename}`));
    }
    let audio_url = null;
    let finalAudioType = null;
    if (req.files && req.files.audio && req.files.audio.length) {
      audio_url = `/uploads/notices/${req.files.audio[0].filename}`;
      finalAudioType = 'record';
    } else if (audio_type === 'tts') {
      finalAudioType = 'tts';
    }
    const [result] = await db.execute(
      'INSERT INTO announcements (title,content,tag_type,image_urls,audio_url,audio_type,created_by) VALUES (?,?,?,?,?,?,?)',
      [title.trim(), content.trim(), tag_type||'全村告示', image_urls, audio_url, finalAudioType, req.admin.id]
    );
    res.json({ code: 0, message: '公告已发布', data: { id: result.insertId } });
  })
);

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', authMiddleware, requireSuper, wrap(async (req, res) => {
  await db.execute('UPDATE announcements SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '公告已撤回' });
}));

// GET /api/admin/exchange/switch — 查询兑换开关状态（公开，村民端也需要读）
router.get('/exchange/switch', wrap(async (req, res) => {
  const [rows] = await db.execute(
    "SELECT cfg_value FROM system_config WHERE cfg_key='exchange_open' LIMIT 1"
  );
  const isOpen = rows.length ? rows[0].cfg_value === '1' : false;
  res.json({ code: 0, data: { open: isOpen } });
}));

// PATCH /api/admin/exchange/switch — 切换兑换开关（仅超管）
router.patch('/exchange/switch', authMiddleware, requireSuper, wrap(async (req, res) => {
  const { open } = req.body;
  const val = open ? '1' : '0';
  await db.execute(
    "INSERT INTO system_config (cfg_key, cfg_value) VALUES ('exchange_open', ?) ON DUPLICATE KEY UPDATE cfg_value=?",
    [val, val]
  );
  res.json({ code: 0, message: open ? '兑换窗口已开启' : '兑换窗口已关闭', data: { open } });
}));


// ── 积分规则管理（score_events CRUD）──
// GET /api/admin/events — 列出所有积分事件（含未启用的）
router.get('/events', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, name, category, points, verify_method, is_active, sort_order FROM score_events ORDER BY category, sort_order'
  );
  res.json({ code: 0, data: rows });
}));

// POST /api/admin/events — 新增积分事件
router.post('/events', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { name, category, points, verify_method } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ code: 400, message: '事件名称不能为空' });
  if (!category || !category.trim()) return res.status(400).json({ code: 400, message: '类别不能为空' });
  if (points === undefined || points === null || isNaN(parseInt(points)) || parseInt(points) === 0) {
    return res.status(400).json({ code: 400, message: '分值不能为0' });
  }
  const [maxRow] = await db.execute('SELECT MAX(sort_order) AS max_order FROM score_events');
  const nextOrder = (maxRow[0].max_order || 0) + 1;
  const [result] = await db.execute(
    'INSERT INTO score_events (name, category, points, verify_method, is_active, sort_order) VALUES (?,?,?,?,1,?)',
    [name.trim(), category.trim(), parseInt(points), (verify_method||'').trim()||null, nextOrder]
  );
  res.json({ code: 0, message: '积分事件已添加', data: { id: result.insertId } });
}));

// PUT /api/admin/events/:id — 编辑积分事件
router.put('/events/:id', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { name, category, points, verify_method } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ code: 400, message: '事件名称不能为空' });
  if (!category || !category.trim()) return res.status(400).json({ code: 400, message: '类别不能为空' });
  if (points === undefined || points === null || isNaN(parseInt(points)) || parseInt(points) === 0) {
    return res.status(400).json({ code: 400, message: '分值不能为0' });
  }
  const [rows] = await db.execute('SELECT id FROM score_events WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ code: 404, message: '积分事件不存在' });
  await db.execute(
    'UPDATE score_events SET name=?, category=?, points=?, verify_method=? WHERE id=?',
    [name.trim(), category.trim(), parseInt(points), (verify_method||'').trim()||null, req.params.id]
  );
  res.json({ code: 0, message: '积分事件已更新' });
}));

// PATCH /api/admin/events/:id/toggle — 启用/禁用积分事件
router.patch('/events/:id/toggle', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { is_active } = req.body;
  const [rows] = await db.execute('SELECT id FROM score_events WHERE id=?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ code: 404, message: '积分事件不存在' });
  await db.execute('UPDATE score_events SET is_active=? WHERE id=?', [is_active ? 1 : 0, req.params.id]);
  res.json({ code: 0, message: is_active ? '已启用' : '已禁用' });
}));

// ── 批量积分录入 ──
// POST /api/admin/scores/batch
router.post('/scores/batch', authMiddleware, requireVillageAdmin, upload.array('images', 4), wrap(async (req, res) => {
  const { villager_ids, event_id, description, custom, custom_points, custom_name } = req.body;
  let ids = [];
  try { ids = JSON.parse(villager_ids); } catch(e) { return res.status(400).json({ code: 400, message: 'villager_ids 格式错误，需要JSON数组' }); }
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: 400, message: '请至少选择一位村民' });
  if (ids.length > 200) return res.status(400).json({ code: 400, message: '单次批量操作最多200人' });

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
    const evtSlug = finalName.replace(/[^一-龥a-zA-Z0-9]/g, '').slice(0, 10) || 'batch';
    const renamedFiles = req.files.map(f => {
      const ext = path.extname(f.filename);
      const newName = `batch_${evtSlug}_${Date.now()}_${Math.random().toString(36).slice(2,4)}${ext}`;
      const oldPath = path.join(UPLOAD_DIR, f.filename);
      const newPath = path.join(UPLOAD_DIR, newName);
      try { fs.renameSync(oldPath, newPath); } catch(e) {}
      return fs.existsSync(newPath) ? newName : f.filename;
    });
    imageUrls = renamedFiles.map(name => `/uploads/${name}`);
  }

  const imgJson = imageUrls.length ? JSON.stringify(imageUrls) : null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const inserted = [];
    for (const vid of ids) {
      const [ins] = await conn.execute(
        `INSERT INTO score_records (villager_id, event_id, event_name, points, show_in_feed, description, image_urls, submitted_by, status)
         VALUES (?,?,?,?,0,?,?,?,?)`,
        [parseInt(vid), finalEventId, finalName, finalPoints, finalDesc, imgJson, req.admin.id, status]
      );
      if (status === 'approved') {
        await conn.execute(
          'UPDATE villagers SET total_score=total_score+?, honor_score=honor_score+? WHERE id=?',
          [finalPoints, finalPoints, parseInt(vid)]
        );
      }
      inserted.push({ id: ins.insertId, villager_id: parseInt(vid) });
    }
    await conn.commit();
    res.json({ code: 0, message: `已为${inserted.length}位村民${status==='approved'?'录入积分并生效':'提交积分，等待审核'}`, data: { count: inserted.length, status } });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// ── 年度积分清零 ──
// POST /api/admin/scores/reset — 手动触发清零（仅超管）
router.post('/scores/reset', authMiddleware, requireSuper, wrap(async (req, res) => {
  const currentYear = new Date().getFullYear();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "UPDATE villagers SET total_score=0 WHERE total_score>0 AND is_active=1"
    );
    const count = result.changedRows;
    await conn.execute(
      "INSERT INTO reset_log (reset_year, villagers_count, triggered_by, admin_id) VALUES (?,?,?,?)",
      [currentYear, count, 'manual', req.admin.id]
    );
    await conn.commit();
    res.json({ code: 0, message: `积分清零完成，共清零${count}位村民的兑换积分（荣誉积分保留）`, data: { count, year: currentYear } });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// GET /api/admin/scores/reset/log — 查询清零历史（村干部+）
router.get('/scores/reset/log', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    `SELECT rl.*, IFNULL(a.name,'系统自动') AS admin_name
     FROM reset_log rl LEFT JOIN admins a ON a.id=rl.admin_id
     ORDER BY rl.created_at DESC LIMIT 20`
  );
  res.json({ code: 0, data: rows });
}));

// ── 村名/位置配置（服务端缓存） ──
let villageConfig = { village_name: '罗峪村', village_short: '罗峪', village_location: '桑植县凉水口镇罗峪村', home_tab: 'my' };
(async function() {
  try {
    const [rows] = await db.execute("SELECT cfg_key, cfg_value FROM system_config WHERE cfg_key IN ('village_name','village_short','village_location','home_tab')");
    rows.forEach(function(r) { if (r.cfg_value) villageConfig[r.cfg_key] = r.cfg_value; });
  } catch(e) {}
})();
router.get('/village-config', wrap(async (req, res) => { res.json({ code: 0, data: villageConfig }); }));
router.put('/village-config', authMiddleware, requireSuper, wrap(async (req, res) => {
  const { village_name, village_short, village_location } = req.body;
  if (village_name) { await db.execute("INSERT INTO system_config (cfg_key,cfg_value) VALUES ('village_name',?) ON DUPLICATE KEY UPDATE cfg_value=?", [village_name.trim(), village_name.trim()]); villageConfig.village_name = village_name.trim(); }
  if (village_short) { await db.execute("INSERT INTO system_config (cfg_key,cfg_value) VALUES ('village_short',?) ON DUPLICATE KEY UPDATE cfg_value=?", [village_short.trim(), village_short.trim()]); villageConfig.village_short = village_short.trim(); }
  if (req.body.home_tab) { await db.execute("INSERT INTO system_config (cfg_key,cfg_value) VALUES ('home_tab',?) ON DUPLICATE KEY UPDATE cfg_value=?", [req.body.home_tab, req.body.home_tab]); villageConfig.home_tab = req.body.home_tab; }
  if (village_location) { await db.execute("INSERT INTO system_config (cfg_key,cfg_value) VALUES ('village_location',?) ON DUPLICATE KEY UPDATE cfg_value=?", [village_location.trim(), village_location.trim()]); villageConfig.village_location = village_location.trim(); }
  res.json({ code: 0, message: '村名配置已更新', data: villageConfig });
}));

module.exports = router;

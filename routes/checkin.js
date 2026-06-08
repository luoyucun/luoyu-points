// routes/checkin.js
const router = require('express').Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const CHECKIN_UPLOAD_DIR = path.join(__dirname, '../uploads/checkin');
if (!fs.existsSync(CHECKIN_UPLOAD_DIR)) fs.mkdirSync(CHECKIN_UPLOAD_DIR, { recursive: true });

const checkinUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, CHECKIN_UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'checkin_' + Date.now() + '_' + Math.random().toString(36).slice(2,6) + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// POST /api/checkin/create — 创建签到活动
router.post('/create', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const { title, score_event_id, score_points } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ code: 400, message: '活动标题不能为空' });
  const pts = parseInt(score_points);
  if (isNaN(pts) || pts === 0) return res.status(400).json({ code: 400, message: '签到分值不能为0' });
  const qrToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const evtId = score_event_id ? parseInt(score_event_id) : null;
  const [result] = await db.execute(
    'INSERT INTO checkin_events (title, score_event_id, score_points, qr_token, created_by) VALUES (?,?,?,?,?)',
    [title.trim(), evtId, pts, qrToken, req.admin.id]
  );
  const checkinUrl = (process.env.FRONTEND_URL || 'http://47.107.31.231') + '/index.html?checkin=' + qrToken;
  res.json({ code: 0, message: '签到活动已创建', data: { id: result.insertId, qr_token: qrToken, url: checkinUrl } });
}));

// GET /api/checkin/:token/info — 扫码后读取活动信息（公开）
router.get('/:token/info', wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, score_points, expired_at FROM checkin_events WHERE qr_token=? AND is_active=1',
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ code: 404, message: '签到活动不存在或已结束' });
  const evt = rows[0];
  if (evt.expired_at && new Date(evt.expired_at) < new Date())
    return res.status(410).json({ code: 410, message: '签到已截止' });
  res.json({ code: 0, data: { id: evt.id, title: evt.title, score_points: evt.score_points } });
}));

// POST /api/checkin/:token/checkin — 村民签到（公开，需验证身份 + 现场拍照）
router.post('/:token/checkin', checkinUpload.single('photo'), wrap(async (req, res) => {
  const { name, id_last4 } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ code: 400, message: '请输入姓名' });
  if (!/^\d{4}$/.test(id_last4)) return res.status(400).json({ code: 400, message: '身份证后4位须为4位数字' });
  if (!req.file) return res.status(400).json({ code: 400, message: '请拍摄现场照片作为签到凭证' });

  const [evtRows] = await db.execute(
    'SELECT id, title, score_event_id, score_points, expired_at FROM checkin_events WHERE qr_token=? AND is_active=1',
    [req.params.token]
  );
  if (!evtRows.length) return res.status(404).json({ code: 404, message: '签到活动不存在或已结束' });
  const evt = evtRows[0];
  if (evt.expired_at && new Date(evt.expired_at) < new Date())
    return res.status(410).json({ code: 410, message: '签到已截止' });

  const [vRows] = await db.execute(
    'SELECT id, name, group_no FROM villagers WHERE name=? AND id_last4=? AND is_active=1',
    [name.trim(), id_last4]
  );
  if (!vRows.length) {
    // Delete uploaded photo if verification fails
    try { fs.unlinkSync(path.join(CHECKIN_UPLOAD_DIR, req.file.filename)); } catch(e) {}
    return res.status(404).json({ code: 404, message: '未找到村民信息，请核实姓名和身份证后4位' });
  }
  const villager = vRows[0];

  const photoUrl = '/uploads/checkin/' + req.file.filename;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [dupRows] = await conn.execute(
      'SELECT id FROM checkin_records WHERE checkin_event_id=? AND villager_id=?',
      [evt.id, villager.id]
    );
    if (dupRows.length) {
      await conn.rollback();
      try { fs.unlinkSync(path.join(CHECKIN_UPLOAD_DIR, req.file.filename)); } catch(e) {}
      return res.status(409).json({ code: 409, message: '您已签到，无需重复签到' });
    }

    const eventName = evt.title + '（签到）';
    const eventId = evt.score_event_id;
    const points = evt.score_points;

    const [srResult] = await conn.execute(
      'INSERT INTO score_records (villager_id, event_id, event_name, points, submitted_by, status) VALUES (?,?,?,?,1,\'approved\')',
      [villager.id, eventId, eventName, points]
    );

    await conn.execute(
      'INSERT INTO checkin_records (checkin_event_id, villager_id, score_record_id, photo_url) VALUES (?,?,?,?)',
      [evt.id, villager.id, srResult.insertId, photoUrl]
    );

    await conn.execute(
      'UPDATE villagers SET total_score=total_score+?, honor_score=honor_score+? WHERE id=?',
      [points, points, villager.id]
    );

    await conn.commit();
    res.json({ code: 0, message: '签到成功！+' + points + '分', data: { villager_name: villager.name, points } });
  } catch (e) {
    await conn.rollback();
    try { fs.unlinkSync(path.join(CHECKIN_UPLOAD_DIR, req.file.filename)); } catch(e2) {}
    throw e;
  } finally {
    conn.release();
  }
}));

// GET /api/checkin/list — 签到活动列表（村干部+）
router.get('/list', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT ce.id, ce.title, ce.score_points, ce.qr_token, ce.is_active, ce.created_at, ce.expired_at, ' +
    '(SELECT COUNT(*) FROM checkin_records cr WHERE cr.checkin_event_id=ce.id) AS checkin_count ' +
    'FROM checkin_events ce ORDER BY ce.created_at DESC LIMIT 50'
  );
  res.json({ code: 0, data: rows });
}));

// GET /api/checkin/:id/records — 查看某活动的签到名单（村干部+）
router.get('/:id/records', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT cr.id, cr.created_at, cr.photo_url, v.name AS villager_name, v.group_no ' +
    'FROM checkin_records cr ' +
    'JOIN villagers v ON v.id = cr.villager_id ' +
    'WHERE cr.checkin_event_id=? ORDER BY cr.created_at DESC',
    [req.params.id]
  );
  res.json({ code: 0, data: rows });
}));

// PATCH /api/checkin/:id/close — 关闭签到活动（村干部+）
router.patch('/:id/close', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  await db.execute('UPDATE checkin_events SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '签到活动已关闭' });
}));

module.exports = router;

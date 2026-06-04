const router = require('express').Router();
const multer = require('multer');
const db     = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/scores
router.get('/', authMiddleware, async (req, res) => {
  const { villager_id, status, page = 1, limit = 20 } = req.query;
  let sql = `
    SELECT r.id, r.villager_id, v.name AS villager_name, v.group_no,
           r.event_name, r.points, r.description, r.image_urls,
           r.status, r.created_at, a.name AS submitted_by_name
    FROM score_records r
    JOIN villagers v ON v.id = r.villager_id
    JOIN admins a ON a.id = r.submitted_by
    WHERE 1=1
  `;
  const params = [];
  if (villager_id) { sql += ' AND r.villager_id = ?'; params.push(villager_id); }
  if (status)      { sql += ' AND r.status = ?';      params.push(status); }
  if (req.admin.role === 'group_leader') {
    sql += ' AND v.group_no = ?'; params.push(req.admin.group_no);
  }
  sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
  const [rows] = await db.execute(sql, params);
  rows.forEach(r => { if (r.image_urls) r.image_urls = JSON.parse(r.image_urls); });
  res.json({ code: 0, data: rows });
});

// POST /api/scores
router.post('/', authMiddleware, upload.array('images', 4), async (req, res) => {
  const { villager_id, event_id, description, custom, custom_points, custom_name } = req.body;
  if (!villager_id) return res.status(400).json({ code: 400, message: 'villager_id 必填' });

  const isCustom = custom === 'true';

  // 自定义积分校验
  if (isCustom) {
    if (!custom_name || !custom_name.trim())
      return res.status(400).json({ code: 400, message: '自定义积分必须填写原因说明' });
    const pts = parseInt(custom_points);
    if (isNaN(pts) || pts === 0)
      return res.status(400).json({ code: 400, message: '积分值不能为0' });
    if (Math.abs(pts) > 100)
      return res.status(400).json({ code: 400, message: '单次自定义积分不能超过100分' });
  } else {
    if (!event_id) return res.status(400).json({ code: 400, message: 'event_id 必填' });
  }

  let evt = null;
  if (!isCustom) {
    const [evRows] = await db.execute('SELECT * FROM score_events WHERE id = ? AND is_active = 1', [event_id]);
    if (!evRows.length) return res.status(400).json({ code: 400, message: '积分事件不存在' });
    evt = evRows[0];
  }

  // 图片上传OSS（未配置时跳过）
  let imageUrls = [];
  if (req.files && req.files.length) {
    try {
      const { uploadToOSS } = require('../config/oss');
      imageUrls = await Promise.all(req.files.map(f => uploadToOSS(f.buffer, f.originalname)));
    } catch (e) {
      console.warn('[OSS跳过]', e.message);
    }
  }

  const finalPoints   = isCustom ? parseInt(custom_points) : evt.points;
  const finalName     = isCustom ? custom_name.trim() : evt.name;
  const finalEventId  = isCustom ? null : event_id;
  const finalDesc     = isCustom ? null : (description || null);

  // 自定义积分所有角色都需要审核；预设事件超管/村干部直接生效
  const status = (!isCustom && ['super', 'village_admin'].includes(req.admin.role)) ? 'approved' : 'pending';

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      `INSERT INTO score_records
       (villager_id, event_id, event_name, points, description, image_urls, submitted_by, status)
       VALUES (?,?,?,?,?,?,?,?)`,
      [villager_id, finalEventId, finalName, finalPoints,
       finalDesc,
       imageUrls.length ? JSON.stringify(imageUrls) : null,
       req.admin.id, status]
    );
    if (status === 'approved') {
      await conn.execute(
        'UPDATE villagers SET total_score = total_score + ? WHERE id = ?',
        [finalPoints, villager_id]
      );
    }
    await conn.commit();
    res.json({
      code: 0,
      message: status === 'approved' ? '录入成功，积分已生效' : '提交成功，等待村干部审核',
      data: { id: ins.insertId, status }
    });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PATCH /api/scores/:id/review
router.patch('/:id/review', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { action } = req.body;
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ code: 400, message: 'action 只能是 approve 或 reject' });

  const [rows] = await db.execute(
    'SELECT * FROM score_records WHERE id = ? AND status = "pending"', [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ code: 404, message: '记录不存在或已处理' });
  const rec = rows[0];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await conn.execute(
      'UPDATE score_records SET status=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
      [newStatus, req.admin.id, rec.id]
    );
    if (action === 'approve') {
      await conn.execute(
        'UPDATE villagers SET total_score = total_score + ? WHERE id = ?',
        [rec.points, rec.villager_id]
      );
    }
    await conn.commit();
    res.json({ code: 0, message: action === 'approve' ? '审核通过，积分已生效' : '已驳回' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// GET /api/scores/events
router.get('/events', authMiddleware, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, name, category, points, verify_method FROM score_events WHERE is_active=1 ORDER BY sort_order'
  );
  res.json({ code: 0, data: rows });
});

// GET /api/scores/stats
router.get('/stats', authMiddleware, requireVillageAdmin, async (req, res) => {
  const [byCategory] = await db.execute(`
    SELECT se.category, SUM(r.points) AS total
    FROM score_records r JOIN score_events se ON se.id = r.event_id
    WHERE r.status = 'approved'
      AND MONTH(r.created_at) = MONTH(NOW()) AND YEAR(r.created_at) = YEAR(NOW())
      AND r.points > 0
    GROUP BY se.category ORDER BY total DESC
  `);
  const [summary] = await db.execute(`
    SELECT
      (SELECT COALESCE(SUM(total_score),0) FROM villagers WHERE is_active=1) AS total_score,
      (SELECT COUNT(*) FROM villagers WHERE is_active=1) AS total_villagers,
      (SELECT COUNT(DISTINCT villager_id) FROM score_records
        WHERE status='approved' AND MONTH(created_at)=MONTH(NOW())) AS active_villagers,
      (SELECT COUNT(*) FROM score_records WHERE status='pending') AS pending_count,
      (SELECT COUNT(*) FROM exchange_records WHERE MONTH(created_at)=MONTH(NOW())) AS month_exchanges
  `);
  res.json({ code: 0, data: { summary: summary[0], by_category: byCategory } });
});

module.exports = router;

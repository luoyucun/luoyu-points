// routes/admin.js — 后台管理专用接口
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin, requireSuper } = require('../middleware/auth');

// GET /api/admin/groups — 获取所有组别（用于下拉框）
router.get('/groups', authMiddleware, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT DISTINCT group_no FROM villagers WHERE is_active=1 AND group_no IS NOT NULL ORDER BY group_no'
  );
  res.json({ code: 0, data: rows.map(r => r.group_no) });
});

// GET /api/admin/dashboard — 数据总览
router.get('/dashboard', authMiddleware, requireVillageAdmin, async (req, res) => {
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
});

// PATCH /api/admin/scores/:id/revoke — 积分撤回（超管）
router.patch('/scores/:id/revoke', authMiddleware, requireSuper, async (req, res) => {
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
    // 已审核的记录才需要回退积分
    if (rec.status === 'approved') {
      await conn.execute('UPDATE villagers SET total_score = total_score - ? WHERE id=?', [rec.points, rec.villager_id]);
    }
    await conn.commit();
    res.json({ code: 0, message: '撤回成功，积分已回退' });
  } catch(e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
});

// POST /api/admin/goods — 新增物资
router.post('/goods', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { name, icon, points_cost, stock } = req.body;
  if (!name || !points_cost) return res.status(400).json({ code: 400, message: '名称和积分为必填' });
  const [rows] = await db.execute('SELECT MAX(sort_order) AS max_order FROM goods');
  const nextOrder = (rows[0].max_order || 0) + 1;
  const [result] = await db.execute(
    'INSERT INTO goods (name, icon, points_cost, stock, is_active, sort_order) VALUES (?,?,?,?,1,?)',
    [name.trim(), icon||'📦', parseInt(points_cost), parseInt(stock)||0, nextOrder]
  );
  res.json({ code: 0, message: '物资添加成功', data: { id: result.insertId } });
});

// PUT /api/admin/goods/:id — 编辑物资
router.put('/goods/:id', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { name, icon, points_cost, stock } = req.body;
  if (!name || !points_cost) return res.status(400).json({ code: 400, message: '名称和积分为必填' });
  await db.execute(
    'UPDATE goods SET name=?, icon=?, points_cost=?, stock=? WHERE id=?',
    [name.trim(), icon||'📦', parseInt(points_cost), parseInt(stock)||0, req.params.id]
  );
  res.json({ code: 0, message: '物资已更新' });
});

// PATCH /api/admin/goods/:id/stock — 物资库存调整（村干部+）
router.patch('/goods/:id/stock', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { stock } = req.body;
  if (stock === undefined || stock < 0) return res.status(400).json({ code: 400, message: '库存数量不能为负数' });
  await db.execute('UPDATE goods SET stock=? WHERE id=?', [parseInt(stock), req.params.id]);
  res.json({ code: 0, message: '库存已更新' });
});

// GET /api/admin/exchange/records — 兑换记录列表
router.get('/exchange/records', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { status, page=1, limit=20 } = req.query;
  let sql = `
    SELECT er.id, er.villager_id, v.name AS villager_name, v.group_no,
           er.goods_name, er.points_cost, er.status, er.created_at
    FROM exchange_records er
    JOIN villagers v ON v.id = er.villager_id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND er.status=?'; params.push(status); }
  sql += ' ORDER BY er.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
  const [rows] = await db.execute(sql, params);
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM exchange_records er JOIN villagers v ON v.id=er.villager_id WHERE 1=1${status?' AND er.status=?':''}`, status?[status]:[]);
  res.json({ code: 0, data: rows, total });
});

// PATCH /api/admin/exchange/:id/deliver — 标记已发放
router.patch('/exchange/:id/deliver', authMiddleware, requireVillageAdmin, async (req, res) => {
  await db.execute('UPDATE exchange_records SET status=? WHERE id=?', ['delivered', req.params.id]);
  res.json({ code: 0, message: '已标记为发放' });
});

// GET /api/admin/export/villagers — 导出村民积分（CSV格式，前端转Excel）
router.get('/export/villagers', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { group_no } = req.query;
  let sql = `
    SELECT v.name, v.gender, v.group_no, v.id_last4, v.total_score,
      (SELECT COALESCE(SUM(points),0) FROM score_records WHERE villager_id=v.id AND status='approved' AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score,
      (SELECT COUNT(*) FROM score_records WHERE villager_id=v.id AND status='approved') AS record_count
    FROM villagers v WHERE v.is_active=1
  `;
  const params = [];
  if (group_no) { sql += ' AND v.group_no=?'; params.push(group_no); }
  sql += ' ORDER BY v.group_no, v.total_score DESC';
  const [rows] = await db.execute(sql, params);
  res.json({ code: 0, data: rows });
});

// GET /api/admin/export/scores — 导出积分记录
router.get('/export/scores', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { start_date, end_date, group_no } = req.query;
  let sql = `
    SELECT v.name AS villager_name, v.group_no, sr.event_name, sr.points,
           sr.description, sr.status, sr.is_revoked, sr.created_at,
           a.name AS submitted_by
    FROM score_records sr
    JOIN villagers v ON v.id=sr.villager_id
    JOIN admins a ON a.id=sr.submitted_by
    WHERE 1=1
  `;
  const params = [];
  if (start_date) { sql += ' AND DATE(sr.created_at) >= ?'; params.push(start_date); }
  if (end_date)   { sql += ' AND DATE(sr.created_at) <= ?'; params.push(end_date); }
  if (group_no)   { sql += ' AND v.group_no = ?'; params.push(group_no); }
  sql += ' ORDER BY sr.created_at DESC LIMIT 5000';
  const [rows] = await db.execute(sql, params);
  res.json({ code: 0, data: rows });
});

module.exports = router;

// PATCH /api/admin/admins/:id/reset-password — 重置密码（超管）
router.patch('/admins/:id/reset-password', authMiddleware, requireSuper, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ code: 400, message: '密码不能少于8位' });
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(new_password, 10);
  await db.execute('UPDATE admins SET password=? WHERE id=?', [hash, req.params.id]);
  res.json({ code: 0, message: '密码重置成功' });
});

// GET /api/admin/announcements — 公告列表（后台）
router.get('/announcements', authMiddleware, requireSuper, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id,title,content,tag_type,is_active,created_at FROM announcements ORDER BY created_at DESC'
  );
  res.json({ code: 0, data: rows });
});

module.exports = router;

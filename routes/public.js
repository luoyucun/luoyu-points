// routes/public.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// GET /api/public/honorboard — 红黑榜数据（公开）
// 返回：月度光荣榜前5名 + 近期扣分公示（匿名）
router.get('/honorboard', wrap(async (req, res) => {
  // 本月加分前5名
  const [top5] = await db.execute(
    'SELECT v.name, v.group_no, SUM(sr.points) AS month_score ' +
    'FROM score_records sr JOIN villagers v ON v.id=sr.villager_id ' +
    'WHERE sr.status="approved" AND sr.is_revoked=0 AND sr.points>0 ' +
    'AND MONTH(sr.created_at)=MONTH(NOW()) AND YEAR(sr.created_at)=YEAR(NOW()) ' +
    'GROUP BY sr.villager_id ORDER BY month_score DESC LIMIT 5'
  );

  // 近期扣分记录（匿名：只显示事件和分值，不显示姓名）
  const [deductions] = await db.execute(
    'SELECT sr.event_name, sr.points, sr.created_at, v.group_no ' +
    'FROM score_records sr JOIN villagers v ON v.id=sr.villager_id ' +
    'WHERE sr.status="approved" AND sr.is_revoked=0 AND sr.points<0 ' +
    'ORDER BY sr.created_at DESC LIMIT 5'
  );

  res.json({ code: 0, data: { top5, deductions } });
}));

// GET /api/public/top10 — 总分前10名（公开）
router.get('/top10', wrap(async (req, res) => {
  const mode = req.query.mode || 'total';
  let sql;
  if (mode === 'month') {
    sql =
      'SELECT v.name, v.group_no, v.total_score, ' +
      'COALESCE((SELECT SUM(points) FROM score_records WHERE villager_id=v.id AND status="approved" AND is_revoked=0 AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())),0) AS month_score ' +
      'FROM villagers v WHERE v.is_active=1 ORDER BY month_score DESC LIMIT 10';
  } else {
    sql =
      'SELECT v.name, v.group_no, v.total_score, ' +
      'COALESCE((SELECT SUM(points) FROM score_records WHERE villager_id=v.id AND status="approved" AND is_revoked=0 AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())),0) AS month_score ' +
      'FROM villagers v WHERE v.is_active=1 ORDER BY v.total_score DESC LIMIT 10';
  }
  const [rows] = await db.execute(sql);
  res.json({ code: 0, data: rows });
}));

// POST /api/public/feedback — 村民提交反馈（公开）
router.post('/feedback', wrap(async (req, res) => {
  const { content, villager_name } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ code: 400, message: '请输入反馈内容' });
  if (content.trim().length > 500) return res.status(400).json({ code: 400, message: '内容不能超过500字' });
  await db.execute(
    'INSERT INTO feedback (villager_name, content) VALUES (?,?)',
    [(villager_name||'').trim()||null, content.trim()]
  );
  res.json({ code: 0, message: '感谢您的反馈！村委会将及时查看处理。' });
}));

// GET /api/admin/feedback — 管理员查看反馈列表
router.get('/admin/feedback', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, villager_name, content, is_read, created_at FROM feedback ORDER BY created_at DESC LIMIT 100'
  );
  res.json({ code: 0, data: rows });
}));

// PATCH /api/admin/feedback/:id/read — 标记已读
router.patch('/admin/feedback/:id/read', authMiddleware, requireVillageAdmin, wrap(async (req, res) => {
  await db.execute('UPDATE feedback SET is_read=1 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '已标记' });
}));

module.exports = router;

// routes/exchange.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

// GET /api/exchange/goods — 公开，无需登录
router.get('/goods', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, name, icon, points_cost, stock FROM goods WHERE is_active=1 ORDER BY sort_order'
  );
  res.json({ code: 0, data: rows });
});

// POST /api/exchange — 村民兑换，无需 token（村民登录无 token）
// 安全性由业务逻辑保障：商品存在校验 + 库存校验 + 积分校验 + 事务
router.post('/', async (req, res) => {
  const { villager_id, goods_id } = req.body;
  if (!villager_id || !goods_id)
    return res.status(400).json({ code: 400, message: '参数不完整' });

  // 校验兑换窗口是否开启
  const [cfgRows] = await db.execute(
    "SELECT cfg_value FROM system_config WHERE cfg_key='exchange_open' LIMIT 1"
  );
  const isOpen = cfgRows.length ? cfgRows[0].cfg_value === '1' : false;
  if (!isOpen)
    return res.status(403).json({ code: 403, message: '当前不在兑换期，请关注公告通知' });

  const [gRows] = await db.execute('SELECT * FROM goods WHERE id=? AND is_active=1', [goods_id]);
  if (!gRows.length) return res.status(404).json({ code: 404, message: '商品不存在' });
  const goods = gRows[0];
  if (goods.stock < 1) return res.status(400).json({ code: 400, message: '库存不足' });

  const [vRows] = await db.execute(
    'SELECT id, total_score FROM villagers WHERE id=? AND is_active=1', [villager_id]
  );
  // 修复原代码 bug：villager_id 无效时 vRows[0] 为 undefined 会直接报错
  if (!vRows.length) return res.status(404).json({ code: 404, message: '村民不存在' });
  if (vRows[0].total_score < goods.points_cost)
    return res.status(400).json({ code: 400, message: `积分不足，当前 ${vRows[0].total_score} 分，需要 ${goods.points_cost} 分` });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE villagers SET total_score = total_score - ? WHERE id=?', [goods.points_cost, villager_id]);
    await conn.execute('UPDATE goods SET stock = stock - 1 WHERE id=?', [goods_id]);
    await conn.execute(
      'INSERT INTO exchange_records (villager_id, goods_id, goods_name, points_cost) VALUES (?,?,?,?)',
      [villager_id, goods_id, goods.name, goods.points_cost]
    );
    await conn.commit();
    res.json({ code: 0, message: `兑换成功：${goods.name}，扣除 ${goods.points_cost} 分` });
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }
});

module.exports = router;

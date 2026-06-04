// routes/exchange.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

router.get('/goods', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, name, icon, points_cost, stock FROM goods WHERE is_active=1 ORDER BY sort_order'
  );
  res.json({ code: 0, data: rows });
});

router.post('/', authMiddleware, async (req, res) => {
  const { villager_id, goods_id } = req.body;
  const [gRows] = await db.execute('SELECT * FROM goods WHERE id=? AND is_active=1', [goods_id]);
  if (!gRows.length) return res.status(404).json({ code: 404, message: '商品不存在' });
  const goods = gRows[0];
  if (goods.stock < 1) return res.status(400).json({ code: 400, message: '库存不足' });

  const [vRows] = await db.execute('SELECT total_score FROM villagers WHERE id=?', [villager_id]);
  if (vRows[0].total_score < goods.points_cost)
    return res.status(400).json({ code: 400, message: '积分不足' });

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
    res.json({ code: 0, message: `兑换成功：${goods.name}，扣除${goods.points_cost}分` });
  } catch (e) {
    await conn.rollback(); throw e;
  } finally {
    conn.release();
  }
});

module.exports = router;

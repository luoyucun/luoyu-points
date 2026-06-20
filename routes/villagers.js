// routes/villagers.js — 村民管理
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin, requireSuper } = require('../middleware/auth');

// ⚠️ 具名路由必须在 /:id 之前，否则会被当作 id 参数匹配

// POST /api/villagers/login — 村民登录（姓名+身份证后4位）
router.post('/login', async (req, res) => {
  const { name, id_last4 } = req.body;
  if (!name || !id_last4)
    return res.status(400).json({ code: 400, message: '姓名和身份证后4位不能为空' });
  if (!/^\d{4}$/.test(id_last4))
    return res.status(400).json({ code: 400, message: '身份证后4位须为4位数字' });

  const [rows] = await db.execute(
    'SELECT id,name,gender,group_no,id_last4,total_score,honor_score,first_login_bonus FROM villagers WHERE name=? AND id_last4=? AND is_active=1',
    [name.trim(), id_last4]
  );
  if (!rows.length)
    return res.status(404).json({ code: 404, message: '未找到匹配的村民信息，请确认姓名和身份证后4位' });

  const villager = rows[0];

  // 首次登录赠送20基础分
  if (!villager.first_login_bonus) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO score_records (villager_id, event_id, event_name, points, show_in_feed, submitted_by, status) VALUES (?,NULL,?,?,0,1,"approved")',
        [villager.id, '首次登录基础积分', 20]
      );
      await conn.execute(
        'UPDATE villagers SET total_score=total_score+10, honor_score=honor_score+10, first_login_bonus=1 WHERE id=?',
        [villager.id]
      );
      await conn.commit();
      villager.total_score += 20;
      villager.honor_score += 20;
      villager.first_login_bonus = 1;
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  }

  // 组内排名
  const [rankRows] = await db.execute(
    'SELECT COUNT(*)+1 AS rank_no FROM villagers WHERE group_no=? AND is_active=1 AND total_score>? AND id!=?',
    [villager.group_no, villager.total_score, villager.id]
  );
  villager.group_rank = rankRows[0].rank_no;

  res.json({ code: 0, message: '登录成功', first_login: true, data: { villager } });
});

// GET /api/villagers/query — 村民公开查询（无需登录，姓名+身份证后4位）
router.get('/query', async (req, res) => {
  const { name, id_last4 } = req.query;
  if (!name || !id_last4) {
    return res.status(400).json({ code: 400, message: '姓名和身份证后4位不能为空' });
  }
  if (!/^\d{4}$/.test(id_last4)) {
    return res.status(400).json({ code: 400, message: '身份证后4位须为4位数字' });
  }
  const [rows] = await db.execute(
    'SELECT id, name, gender, group_no, id_last4, total_score, honor_score FROM villagers WHERE name = ? AND id_last4 = ? AND is_active = 1',
    [name.trim(), id_last4]
  );
  if (!rows.length) {
    return res.status(404).json({ code: 404, message: '未找到匹配的村民信息，请确认姓名和身份证后4位是否正确' });
  }
  const villager = rows[0];

  // 组内排名
  const [rankRows] = await db.execute(
    'SELECT COUNT(*)+1 AS rank_no FROM villagers WHERE group_no = ? AND is_active = 1 AND total_score > ? AND id != ?',
    [villager.group_no, villager.total_score, villager.id]
  );
  villager.group_rank = rankRows[0].rank_no;

  // 已审核积分记录（最近20条）
  const [records] = await db.execute(`
    SELECT sr.points, sr.event_name, sr.description, sr.created_at,
           se.category
    FROM score_records sr
    LEFT JOIN score_events se ON sr.event_id = se.id
    WHERE sr.villager_id = ? AND sr.status = 'approved'
    ORDER BY sr.created_at DESC LIMIT 20
  `, [villager.id]);

  res.json({ code: 0, data: { villager, records } });
});

// GET /api/villagers/groups/public — 公开组别列表（无需登录，排行榜下拉框用）
router.get('/groups/public', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT DISTINCT group_no FROM villagers WHERE is_active=1 AND group_no IS NOT NULL ORDER BY group_no'
  );
  res.json({ code: 0, data: rows.map(r => r.group_no) });
});

// GET /api/villagers/:id/exchanges — 村民兑换记录（无需登录，村民端展示待领取）
router.get('/:id/exchanges', async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, goods_name, points_cost, status, created_at
     FROM exchange_records WHERE villager_id = ? ORDER BY created_at DESC LIMIT 20`,
    [req.params.id]
  );
  res.json({ code: 0, data: rows });
});

// GET /api/villagers/rank/public — 公开排行榜（无需登录，村民端使用）
router.get('/rank/public', async (req, res) => {
  const group = req.query.group_no || '';
  let rows;
  if (group) {
    [rows] = await db.execute(`
      SELECT name, gender, group_no, total_score,
        (SELECT COALESCE(SUM(points),0) FROM score_records
         WHERE villager_id = v.id AND status='approved'
           AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score
      FROM villagers v
      WHERE group_no = ? AND is_active = 1
      ORDER BY total_score DESC LIMIT 20
    `, [group]);
  } else {
    [rows] = await db.execute(`
      SELECT name, gender, group_no, total_score,
        (SELECT COALESCE(SUM(points),0) FROM score_records
         WHERE villager_id = v.id AND status='approved'
           AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score
      FROM villagers v
      WHERE is_active = 1
      ORDER BY total_score DESC LIMIT 50
    `);
  }
  res.json({ code: 0, data: rows });
});

// GET /api/villagers/group/rank — 排行榜（传 group_no 查组内，不传查全村）
router.get('/group/rank', authMiddleware, async (req, res) => {
  let group = req.query.group_no;
  // 小组长只能看本组
  if (req.admin.role === 'group_leader') {
    group = req.admin.group_no;
  }

  let rows;
  if (group) {
    [rows] = await db.execute(`
      SELECT name, gender, group_no, total_score,
        (SELECT COALESCE(SUM(points),0) FROM score_records
         WHERE villager_id = v.id AND status='approved'
           AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score
      FROM villagers v
      WHERE group_no = ? AND is_active = 1
      ORDER BY total_score DESC LIMIT 20
    `, [group]);
  } else {
    [rows] = await db.execute(`
      SELECT name, gender, group_no, total_score,
        (SELECT COALESCE(SUM(points),0) FROM score_records
         WHERE villager_id = v.id AND status='approved'
           AND MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS month_score
      FROM villagers v
      WHERE is_active = 1
      ORDER BY total_score DESC LIMIT 50
    `);
  }
  res.json({ code: 0, data: rows });
});

// GET /api/villagers — 查询村民列表（支持姓名/组别筛选）
router.get('/', authMiddleware, async (req, res) => {
  const { name, group_no, page = 1, limit = 50 } = req.query;
  let sql = 'SELECT id, name, gender, group_no, id_last4, total_score, honor_score FROM villagers WHERE is_active = 1';
  const params = [];
  if (name)     { sql += ' AND name LIKE ?';     params.push(`%${name}%`); }
  if (group_no) { sql += ' AND group_no = ?';    params.push(group_no); }
  if (req.admin.role === 'group_leader') {
    sql += ' AND group_no = ?'; params.push(req.admin.group_no);
  }
  sql += ' ORDER BY group_no, name LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
  const [rows] = await db.execute(sql, params);
  // 总条数
  let countSql = 'SELECT COUNT(*) AS total FROM villagers WHERE is_active = 1';
  const countParams = [];
  if (name)     { countSql += ' AND name LIKE ?';     countParams.push('%' + name + '%'); }
  if (group_no) { countSql += ' AND group_no = ?';    countParams.push(group_no); }
  if (req.admin.role === 'group_leader') {
    countSql += ' AND group_no = ?'; countParams.push(req.admin.group_no);
  }
  const [[{ total }]] = await db.execute(countSql, countParams);
  res.json({ code: 0, data: rows, total });
});

// GET /api/villagers/:id — 村民详情 + 近期积分
router.get('/:id', authMiddleware, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, name, gender, group_no, id_last4, total_score, honor_score FROM villagers WHERE id = ? AND is_active = 1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ code: 404, message: '村民不存在' });
  const villager = rows[0];

  const [monthly] = await db.execute(`
    SELECT COALESCE(SUM(points),0) AS month_score
    FROM score_records
    WHERE villager_id = ? AND status = 'approved'
      AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
  `, [req.params.id]);

  const [rankRows] = await db.execute(`
    SELECT COUNT(*)+1 AS rank_no FROM villagers v
    WHERE v.group_no = ? AND v.is_active = 1
      AND v.total_score > ? AND v.id != ?
  `, [villager.group_no, villager.total_score, villager.id]);

  res.json({ code: 0, data: {
    ...villager,
    month_score: monthly[0].month_score,
    group_rank:  rankRows[0].rank_no
  }});
});

// POST /api/villagers — 新增村民（村干部+）
router.post('/', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { name, gender, group_no, id_last4 } = req.body;
  if (!name || !gender || !group_no || !id_last4)
    return res.status(400).json({ code: 400, message: '姓名、性别、所属组、身份证后4位均为必填' });
  if (!/^\d{4}$/.test(id_last4))
    return res.status(400).json({ code: 400, message: '身份证后4位必须是4位数字' });

  const [result] = await db.execute(
    'INSERT INTO villagers (name, gender, group_no, id_last4) VALUES (?,?,?,?)',
    [name, gender, group_no, id_last4]
  );
  res.json({ code: 0, message: '添加成功', data: { id: result.insertId } });
});

// PUT /api/villagers/:id — 修改村民信息（村干部+）
router.put('/:id', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { name, gender, group_no, id_last4 } = req.body;
  await db.execute(
    'UPDATE villagers SET name=?, gender=?, group_no=?, id_last4=? WHERE id=?',
    [name, gender, group_no, id_last4, req.params.id]
  );
  res.json({ code: 0, message: '修改成功' });
});

module.exports = router;

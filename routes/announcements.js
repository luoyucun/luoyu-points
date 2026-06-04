// routes/announcements.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireVillageAdmin } = require('../middleware/auth');

router.get('/', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, content, tag_type, created_at FROM announcements WHERE is_active=1 ORDER BY created_at DESC LIMIT 20'
  );
  res.json({ code: 0, data: rows });
});

router.post('/', authMiddleware, requireVillageAdmin, async (req, res) => {
  const { title, content, tag_type } = req.body;
  if (!title || !content) return res.status(400).json({ code: 400, message: '标题和内容必填' });
  await db.execute(
    'INSERT INTO announcements (title, content, tag_type, created_by) VALUES (?,?,?,?)',
    [title, content, tag_type || '全村告示', req.admin.id]
  );
  res.json({ code: 0, message: '公告发布成功' });
});

router.delete('/:id', authMiddleware, requireVillageAdmin, async (req, res) => {
  await db.execute('UPDATE announcements SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '公告已撤回' });
});

module.exports = router;

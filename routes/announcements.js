// routes/announcements.js
const router = require('express').Router();
const db = require('../config/db');
const { authMiddleware, requireSuper } = require('../middleware/auth');

// GET — 公开，无需登录
router.get('/', async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, title, content, tag_type, created_at FROM announcements WHERE is_active=1 ORDER BY created_at DESC LIMIT 20'
  );
  res.json({ code: 0, data: rows });
});

// POST — 仅超管
router.post('/', authMiddleware, requireSuper, async (req, res) => {
  const { title, content, tag_type } = req.body;
  if (!title || !content) return res.status(400).json({ code: 400, message: '标题和内容必填' });
  await db.execute(
    'INSERT INTO announcements (title, content, tag_type, created_by) VALUES (?,?,?,?)',
    [title, content, tag_type || '全村告示', req.admin.id]
  );
  res.json({ code: 0, message: '公告发布成功' });
});

// DELETE — 仅超管
router.delete('/:id', authMiddleware, requireSuper, async (req, res) => {
  await db.execute('UPDATE announcements SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ code: 0, message: '公告已撤回' });
});

module.exports = router;

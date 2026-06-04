// routes/auth.js — 登录 / 改密
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });

  const [rows] = await db.execute(
    'SELECT * FROM admins WHERE username = ? AND is_active = 1', [username]
  );
  if (!rows.length)
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });

  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin.password);
  if (!ok)
    return res.status(401).json({ code: 401, message: '用户名或密码错误' });

  const token = jwt.sign(
    { id: admin.id, username: admin.username, name: admin.name,
      role: admin.role, group_no: admin.group_no },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({ code: 0, message: '登录成功', data: {
    token,
    admin: { id: admin.id, name: admin.name, role: admin.role, group_no: admin.group_no }
  }});
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password || new_password.length < 8)
    return res.status(400).json({ code: 400, message: '新密码不能少于8位' });

  const [rows] = await db.execute('SELECT password FROM admins WHERE id = ?', [req.admin.id]);
  const ok = await bcrypt.compare(old_password, rows[0].password);
  if (!ok) return res.status(401).json({ code: 401, message: '原密码错误' });

  const hash = await bcrypt.hash(new_password, 10);
  await db.execute('UPDATE admins SET password = ? WHERE id = ?', [hash, req.admin.id]);
  res.json({ code: 0, message: '密码修改成功，请重新登录' });
});

module.exports = router;

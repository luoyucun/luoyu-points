// routes/admins.js — 管理员账户管理
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authMiddleware, requireSuper } = require('../middleware/auth');

// GET /api/admins — 管理员列表（超管）
router.get('/', authMiddleware, requireSuper, async (req, res) => {
  const [rows] = await db.execute(
    'SELECT id, username, name, role, group_no, is_active, created_at FROM admins ORDER BY id'
  );
  res.json({ code: 0, data: rows });
});

// POST /api/admins — 新建管理员账号（超管）
router.post('/', authMiddleware, requireSuper, async (req, res) => {
  const { username, password, name, role, group_no } = req.body;
  if (!username || !password || !name || !role)
    return res.status(400).json({ code: 400, message: '用户名、密码、姓名、角色均为必填' });
  if (password.length < 8)
    return res.status(400).json({ code: 400, message: '密码不能少于8位' });
  if (role === 'group_leader' && !group_no)
    return res.status(400).json({ code: 400, message: '组长必须指定所属组' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const [result] = await db.execute(
      'INSERT INTO admins (username, password, name, role, group_no) VALUES (?,?,?,?,?)',
      [username, hash, name, role, group_no || null]
    );
    res.json({ code: 0, message: '账号创建成功', data: { id: result.insertId } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ code: 400, message: '用户名已存在' });
    throw e;
  }
});

// PATCH /api/admins/:id/status — 启用/禁用账号（超管）
router.patch('/:id/status', authMiddleware, requireSuper, async (req, res) => {
  const { is_active } = req.body;
  await db.execute('UPDATE admins SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, req.params.id]);
  res.json({ code: 0, message: is_active ? '账号已启用' : '账号已禁用' });
});

// PATCH /api/admins/:id/reset-password — 超管重置他人密码
router.patch('/:id/reset-password', authMiddleware, requireSuper, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ code: 400, message: '新密码不能少于8位' });
  const hash = await bcrypt.hash(new_password, 10);
  await db.execute('UPDATE admins SET password = ? WHERE id = ?', [hash, req.params.id]);
  res.json({ code: 0, message: '密码重置成功' });
});

module.exports = router;

const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未登录或 token 已过期' });
  }
  const token = header.slice(7);
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ code: 401, message: 'token 无效，请重新登录' });
  }
}

function requireVillageAdmin(req, res, next) {
  if (['super', 'village_admin'].includes(req.admin.role)) return next();
  return res.status(403).json({ code: 403, message: '权限不足，需要村干部以上角色' });
}

function requireSuper(req, res, next) {
  if (req.admin.role === 'super') return next();
  return res.status(403).json({ code: 403, message: '权限不足，需要超级管理员' });
}

module.exports = { authMiddleware, requireVillageAdmin, requireSuper };

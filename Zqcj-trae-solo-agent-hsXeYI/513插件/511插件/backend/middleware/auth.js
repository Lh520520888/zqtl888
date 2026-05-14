const jwt = require('jsonwebtoken');
const { User } = require('../models/db');

const JWT_SECRET = 'leisu-autoremind-secret-key-2024';
const JWT_EXPIRES_IN = '7d';

const generateToken = (user) => {
  const payload = { id: user.id, username: user.username };
  if (user.role) {
    payload.role = user.role;
  }
  return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ success: false, message: '令牌无效或已过期' });
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    return res.status(401).json({ success: false, message: '用户不存在' });
  }

  if (user.status !== 1) {
    return res.status(403).json({ success: false, message: '账户已被禁用' });
  }

  if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
    return res.status(403).json({ success: false, message: '账户已过期' });
  }

  const deviceId = req.body?.device_id || req.query?.device_id;
  if (deviceId && user.devices && user.devices.length > 0) {
    const deviceExists = user.devices.some(d => d.deviceId === deviceId);
    if (!deviceExists) {
      return res.status(403).json({
        success: false,
        message: '设备数量超限，您的账号已在其他设备登录，当前设备已被移除',
        code: 'DEVICE_REMOVED'
      });
    }
  }

  req.user = user;
  req.userId = user.id;
  next();
};

const adminAuthMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未授权访问' });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ success: false, message: '令牌无效或已过期' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ success: false, message: '需要管理员权限' });
  }

  req.admin = decoded;
  next();
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.ip ||
         'unknown';
};

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authMiddleware,
  adminAuthMiddleware,
  getClientIp
};

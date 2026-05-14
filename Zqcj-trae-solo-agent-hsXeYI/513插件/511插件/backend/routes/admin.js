const express = require('express');
const bcrypt = require('bcryptjs');
const { User, LoginLog, AdminUser } = require('../models/db');
const { generateToken, adminAuthMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ success: false, message: '请输入用户名和密码' });
    }

    const admin = await AdminUser.findByUsername(username);
    if (!admin) {
      return res.json({ success: false, message: '用户名或密码错误' });
    }

    const isPasswordValid = bcrypt.compareSync(password, admin.password);
    if (!isPasswordValid) {
      return res.json({ success: false, message: '用户名或密码错误' });
    }

    const token = generateToken({ id: admin.id, username: admin.username, role: admin.role });

    res.json({
      success: true,
      message: '登录成功',
      token,
      admin: { id: admin.id, username: admin.username, role: admin.role }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

router.get('/stats', adminAuthMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.count();
    const activeUsers = await User.getActiveCount();
    const expiredUsers = await User.getExpiredCount();
    const loginStats = await LoginLog.getStats();
    
    const stats = { totalUsers, activeUsers, expiredUsers, loginStats };
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.json({ success: false, message: '获取统计数据失败' });
  }
});

router.get('/users', adminAuthMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await User.getAll(parseInt(page), parseInt(limit));
    const formattedUsers = await Promise.all(result.users.map(async u => ({
      ...u,
      expires_at: u.expiresAt,
      device_id: u.devices && u.devices.length > 0 ? u.devices[0].deviceId : null,
      device_name: u.devices && u.devices.length > 0 ? u.devices[0].deviceName : null,
      devices_count: u.devices ? u.devices.length : 0,
      devices_list: u.devices || [],
      created_at: u.createdAt,
      updated_at: u.updatedAt,
      last_login_at: u.lastLoginAt,
      login_count: u.loginCount
    })));
    res.json({ success: true, users: formattedUsers, total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages });
  } catch (error) {
    console.error('Get users error:', error);
    res.json({ success: false, message: '获取用户列表失败' });
  }
});

router.get('/users/search', adminAuthMiddleware, async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.json({ success: true, users: [] });
    }
    const users = await User.search(keyword);
    const formattedUsers = users.map(u => ({
      ...u,
      expires_at: u.expiresAt,
      device_id: u.devices && u.devices.length > 0 ? u.devices[0].deviceId : null,
      device_name: u.devices && u.devices.length > 0 ? u.devices[0].deviceName : null,
      devices_count: u.devices ? u.devices.length : 0,
      devices_list: u.devices || [],
      created_at: u.createdAt,
      updated_at: u.updatedAt,
      last_login_at: u.lastLoginAt,
      login_count: u.loginCount
    }));
    res.json({ success: true, users: formattedUsers });
  } catch (error) {
    console.error('Search users error:', error);
    res.json({ success: false, message: '搜索用户失败' });
  }
});

router.get('/users/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const user = await User.findById(parseInt(req.params.id));
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }
    const loginLogs = await LoginLog.getByUserId(parseInt(req.params.id));
    const formattedUser = {
      ...user,
      expires_at: user.expiresAt,
      device_id: user.devices && user.devices.length > 0 ? user.devices[0].deviceId : null,
      device_name: user.devices && user.devices.length > 0 ? user.devices[0].deviceName : null,
      devices_count: user.devices ? user.devices.length : 0,
      devices_list: user.devices || [],
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      last_login_at: user.lastLoginAt,
      login_count: user.loginCount
    };
    res.json({ success: true, user: formattedUser, loginLogs });
  } catch (error) {
    console.error('Get user error:', error);
    res.json({ success: false, message: '获取用户信息失败' });
  }
});

router.post('/users', adminAuthMiddleware, async (req, res) => {
  try {
    const { username, password, expires_at } = req.body;

    if (!username || !password) {
      return res.json({ success: false, message: '用户名和密码不能为空' });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.json({ success: false, message: '用户名已存在' });
    }

    const userId = await User.create(username, password, expires_at || null);
    res.json({ success: true, message: '用户创建成功', userId });
  } catch (error) {
    console.error('Create user error:', error);
    res.json({ success: false, message: '创建用户失败' });
  }
});

router.put('/users/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { status, expires_at } = req.body;
    const user = await User.findById(parseInt(req.params.id));
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    await User.update(parseInt(req.params.id), { status, expiresAt: expires_at });
    res.json({ success: true, message: '用户更新成功' });
  } catch (error) {
    console.error('Update user error:', error);
    res.json({ success: false, message: '更新用户失败' });
  }
});

router.delete('/users/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const user = await User.findById(parseInt(req.params.id));
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    await User.delete(parseInt(req.params.id));
    res.json({ success: true, message: '用户删除成功' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.json({ success: false, message: '删除用户失败' });
  }
});

router.get('/login-logs', adminAuthMiddleware, async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const logs = await LoginLog.getRecent(parseInt(limit));
    const formattedLogs = logs.map(log => ({
      ...log,
      user_id: log.userId,
      device_id: log.deviceId,
      device_name: log.deviceName,
      ip_address: log.ipAddress,
      user_agent: log.userAgent,
      created_at: log.createdAt,
      error_message: log.errorMessage
    }));
    res.json({ success: true, logs: formattedLogs });
  } catch (error) {
    console.error('Get login logs error:', error);
    res.json({ success: false, message: '获取登录日志失败' });
  }
});

router.put('/admin/password', adminAuthMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.json({ success: false, message: '请填写完整信息' });
    }

    const admin = await AdminUser.findByUsername(req.admin.username);
    if (!bcrypt.compareSync(oldPassword, admin.password)) {
      return res.json({ success: false, message: '原密码错误' });
    }

    await AdminUser.updatePassword(admin.id, newPassword);
    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('Change password error:', error);
    res.json({ success: false, message: '修改密码失败' });
  }
});

module.exports = router;

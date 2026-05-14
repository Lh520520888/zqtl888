const express = require('express');
const bcrypt = require('bcryptjs');
const { User, LoginLog } = require('../models/db');
const { generateToken, authMiddleware, getClientIp } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password, device_id, device_name } = req.body;

    if (!username || !password) {
      await LoginLog.create(null, device_id, device_name, getClientIp(req), req.headers['user-agent'], false, '缺少用户名或密码');
      return res.json({ success: false, message: '请输入用户名和密码' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      await LoginLog.create(null, device_id, device_name, getClientIp(req), req.headers['user-agent'], false, '用户不存在');
      return res.json({ success: false, message: '用户名或密码错误' });
    }

    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      await LoginLog.create(user.id, device_id, device_name, getClientIp(req), req.headers['user-agent'], false, '密码错误');
      return res.json({ success: false, message: '用户名或密码错误' });
    }

    if (user.status !== 1) {
      await LoginLog.create(user.id, device_id, device_name, getClientIp(req), req.headers['user-agent'], false, '账户已被禁用');
      return res.json({ success: false, message: '账户已被禁用' });
    }

    if (user.expiresAt && new Date(user.expiresAt) < new Date()) {
      await LoginLog.create(user.id, device_id, device_name, getClientIp(req), req.headers['user-agent'], false, '账户已过期');
      return res.json({ success: false, message: '账户已过期' });
    }

    if (device_id) {
      const currentDevices = await User.getDevices(user.id);
      const MAX_DEVICES = 4;

      if (currentDevices.length >= MAX_DEVICES) {
        const existingDevice = currentDevices.find(d => d.deviceId === device_id);
        if (!existingDevice) {
          const removedDevice = await User.removeOldestDevice(user.id);
          console.log(`用户 ${username} 设备数量已达上限，移除最旧设备: ${removedDevice?.deviceName || removedDevice?.deviceId}`);
        }
      }

      await User.addDevice(user.id, {
        deviceId: device_id,
        deviceName: device_name || '雷速足球自动提醒',
        ipAddress: getClientIp(req)
      });
    }

    await LoginLog.create(user.id, device_id, device_name, getClientIp(req), req.headers['user-agent'], true);

    const token = generateToken(user);
    const devices = await User.getDevices(user.id);

    const userInfo = {
      id: user.id,
      username: user.username,
      status: user.status,
      expires_at: user.expiresAt,
      created_at: user.createdAt,
      devices_count: devices.length,
      devices: devices.map(d => ({
        device_id: d.deviceId,
        device_name: d.deviceName,
        last_login_at: d.lastLoginAt
      }))
    };

    res.json({
      success: true,
      message: '登录成功',
      token,
      user: userInfo
    });
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

router.post('/verify', authMiddleware, (req, res) => {
  res.json({
    success: true,
    message: '令牌有效',
    user: req.user
  });
});

router.post('/logout', authMiddleware, (req, res) => {
  res.json({ success: true, message: '登出成功' });
});

router.get('/profile', authMiddleware, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

router.post('/devices/remove', authMiddleware, async (req, res) => {
  try {
    const { device_id } = req.body;
    const currentDeviceId = req.headers['x-device-id'];

    if (!device_id) {
      return res.json({ success: false, message: '缺少设备ID' });
    }

    if (currentDeviceId === device_id) {
      return res.json({ success: false, message: '不能踢出自己的设备，请在其他设备登录后操作' });
    }

    const user = await User.findById(req.userId);
    const deviceExists = user.devices && user.devices.some(d => d.deviceId === device_id);

    if (!deviceExists) {
      return res.json({ success: false, message: '设备不存在' });
    }

    await User.removeDevice(req.userId, device_id);
    const devices = await User.getDevices(req.userId);

    res.json({
      success: true,
      message: '设备已移除',
      devices_count: devices.length,
      devices: devices.map(d => ({
        device_id: d.deviceId,
        device_name: d.deviceName,
        last_login_at: d.lastLoginAt
      }))
    });
  } catch (error) {
    console.error('Remove device error:', error);
    res.json({ success: false, message: '移除设备失败' });
  }
});

module.exports = router;

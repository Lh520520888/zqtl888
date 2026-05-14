const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

let db = {
  users: [],
  loginLogs: [],
  adminUsers: []
};

function loadDb() {
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    db = JSON.parse(data);
  } else {
    initDb();
  }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function initDb() {
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.adminUsers.push({
    id: 1,
    username: 'admin',
    password: hashedPassword,
    role: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  
  // 测试账号 - 也可以用于Chrome扩展测试
  db.users.push({
    id: 1,
    username: 'test',
    password: bcrypt.hashSync('123456', 10),
    deviceId: null,
    deviceName: null,
    status: 1,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
    loginCount: 0
  });
  
  saveDb();
  console.log('默认管理员账号已创建: admin / admin123');
  console.log('默认测试账号已创建: test / 123456');
}

loadDb();

const User = {
  create: (username, password, expiresAt = null) => {
    return new Promise((resolve, reject) => {
      const hashedPassword = bcrypt.hashSync(password, 10);
      const id = db.users.length + 1;
      db.users.push({
        id,
        username,
        password: hashedPassword,
        devices: [],
        status: 1,
        expiresAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
        loginCount: 0
      });
      saveDb();
      resolve(id);
    });
  },

  findByUsername: (username) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.username === username);
      resolve(user);
    });
  },

  findById: (id) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user) {
        const { password, ...userInfo } = user;
        resolve(userInfo);
      } else {
        resolve(null);
      }
    });
  },

  getAll: (page = 1, limit = 20) => {
    return new Promise((resolve, reject) => {
      const start = (page - 1) * limit;
      const end = start + limit;
      const users = db.users.slice(start, end).map(u => {
        const { password, ...userInfo } = u;
        return userInfo;
      }).reverse();
      const total = db.users.length;
      resolve({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
    });
  },

  search: (keyword) => {
    return new Promise((resolve, reject) => {
      const users = db.users.filter(u =>
        u.username.includes(keyword) ||
        (u.devices && u.devices.some(d => d.deviceId && d.deviceId.includes(keyword)))
      ).map(u => {
        const { password, ...userInfo } = u;
        return userInfo;
      }).reverse();
      resolve(users);
    });
  },

  update: (id, data) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user) {
        if (data.status !== undefined) user.status = data.status;
        if (data.expiresAt !== undefined) user.expiresAt = data.expiresAt;
        if (data.devices !== undefined) user.devices = data.devices;
        user.updatedAt = new Date().toISOString();
        saveDb();
      }
      resolve();
    });
  },

  addDevice: (id, deviceInfo) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user) {
        if (!user.devices) user.devices = [];
        const existingDevice = user.devices.find(d => d.deviceId === deviceInfo.deviceId);
        if (existingDevice) {
          existingDevice.lastLoginAt = new Date().toISOString();
          existingDevice.ipAddress = deviceInfo.ipAddress || existingDevice.ipAddress;
          existingDevice.deviceName = deviceInfo.deviceName || existingDevice.deviceName;
        } else {
          user.devices.push({
            deviceId: deviceInfo.deviceId,
            deviceName: deviceInfo.deviceName || '未知设备',
            ipAddress: deviceInfo.ipAddress || 'unknown',
            lastLoginAt: new Date().toISOString()
          });
        }
        user.lastLoginAt = new Date().toISOString();
        user.loginCount = (user.loginCount || 0) + 1;
        user.updatedAt = new Date().toISOString();
        saveDb();
      }
      resolve();
    });
  },

  removeDevice: (id, deviceId) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user && user.devices) {
        user.devices = user.devices.filter(d => d.deviceId !== deviceId);
        user.updatedAt = new Date().toISOString();
        saveDb();
      }
      resolve();
    });
  },

  removeOldestDevice: (id) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user && user.devices && user.devices.length > 0) {
        user.devices.sort((a, b) => new Date(a.lastLoginAt) - new Date(b.lastLoginAt));
        const removed = user.devices.shift();
        user.updatedAt = new Date().toISOString();
        saveDb();
        resolve(removed);
      } else {
        resolve(null);
      }
    });
  },

  getDevices: (id) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      resolve(user ? (user.devices || []) : []);
    });
  },

  updateLoginInfo: (id, deviceId, deviceName) => {
    return new Promise((resolve, reject) => {
      const user = db.users.find(u => u.id === id);
      if (user) {
        user.lastLoginAt = new Date().toISOString();
        user.loginCount = (user.loginCount || 0) + 1;
        saveDb();
      }
      resolve();
    });
  },

  delete: (id) => {
    return new Promise((resolve, reject) => {
      db.users = db.users.filter(u => u.id !== id);
      saveDb();
      resolve();
    });
  },

  count: () => {
    return new Promise((resolve, reject) => {
      resolve(db.users.length);
    });
  },

  getActiveCount: () => {
    return new Promise((resolve, reject) => {
      const count = db.users.filter(u => {
        const isActive = u.status === 1;
        const isNotExpired = !u.expiresAt || new Date(u.expiresAt) > new Date();
        return isActive && isNotExpired;
      }).length;
      resolve(count);
    });
  },

  getExpiredCount: () => {
    return new Promise((resolve, reject) => {
      const count = db.users.filter(u => u.expiresAt && new Date(u.expiresAt) <= new Date()).length;
      resolve(count);
    });
  }
};

const LoginLog = {
  create: (userId, deviceId, deviceName, ipAddress, userAgent, success, errorMessage = null) => {
    return new Promise((resolve, reject) => {
      const id = db.loginLogs.length + 1;
      db.loginLogs.push({
        id,
        userId,
        deviceId,
        deviceName,
        ipAddress,
        userAgent,
        success: success ? 1 : 0,
        errorMessage,
        createdAt: new Date().toISOString()
      });
      saveDb();
      resolve(id);
    });
  },

  getByUserId: (userId, limit = 50) => {
    return new Promise((resolve, reject) => {
      const logs = db.loginLogs.filter(l => l.userId === userId)
        .slice(-limit)
        .reverse();
      resolve(logs);
    });
  },

  getRecent: (limit = 100) => {
    return new Promise((resolve, reject) => {
      const logs = db.loginLogs.slice(-limit).reverse().map(log => {
        const user = db.users.find(u => u.id === log.userId);
        return { ...log, username: user ? user.username : null };
      });
      resolve(logs);
    });
  },

  getStats: () => {
    return new Promise((resolve, reject) => {
      const today = new Date().toISOString().split('T')[0];
      const stats = {
        todayLogins: 0,
        todayFailed: 0,
        totalLogins: 0
      };
      
      db.loginLogs.forEach(log => {
        const logDate = log.createdAt.split('T')[0];
        if (logDate === today) {
          if (log.success === 1) stats.todayLogins++;
          else stats.todayFailed++;
        }
        if (log.success === 1) stats.totalLogins++;
      });
      
      resolve(stats);
    });
  }
};

const AdminUser = {
  findByUsername: (username) => {
    return new Promise((resolve, reject) => {
      const admin = db.adminUsers.find(u => u.username === username);
      resolve(admin);
    });
  },

  updatePassword: (id, newPassword) => {
    return new Promise((resolve, reject) => {
      const admin = db.adminUsers.find(u => u.id === id);
      if (admin) {
        admin.password = bcrypt.hashSync(newPassword, 10);
        admin.updatedAt = new Date().toISOString();
        saveDb();
      }
      resolve();
    });
  }
};

module.exports = { initDatabase: loadDb, User, LoginLog, AdminUser };

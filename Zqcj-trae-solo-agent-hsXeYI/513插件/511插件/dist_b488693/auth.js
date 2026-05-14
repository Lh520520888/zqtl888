// 授权服务客户端
class AuthService {
  constructor() {
    this.baseUrl = 'http://103.146.231.236:8080/api/v1';
    this.tokenKey = 'auth_token';
    this.userKey = 'auth_user';
    this.deviceIdKey = 'device_id';
  }

  async getDeviceId() {
    const result = await chrome.storage.local.get([this.deviceIdKey]);
    if (result[this.deviceIdKey]) {
      return result[this.deviceIdKey];
    }
    const deviceId = this.generateDeviceId();
    await chrome.storage.local.set({ [this.deviceIdKey]: deviceId });
    return deviceId;
  }

  generateDeviceId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async getToken() {
    const result = await chrome.storage.local.get([this.tokenKey]);
    return result[this.tokenKey] || null;
  }

  async saveAuth(token, user) {
    await chrome.storage.local.set({
      [this.tokenKey]: token,
      [this.userKey]: user
    });
  }

  async clearAuth() {
    await chrome.storage.local.remove([this.tokenKey, this.userKey]);
  }

  async getUser() {
    const result = await chrome.storage.local.get([this.userKey]);
    return result[this.userKey] || null;
  }

  async isLoggedIn() {
    const token = await this.getToken();
    if (!token) return false;
    try {
      const result = await this.verifyToken();
      return result.success;
    } catch (error) {
      return false;
    }
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const token = await this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : undefined,
      ...options.headers
    };
    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();

      if (response.status === 403 && data.code === 'DEVICE_REMOVED' && endpoint !== '/devices/remove') {
        console.log('[MatchPulse] 当前设备已被移除，正在清除登录状态');
        await this.clearAuth();
        chrome.runtime.sendMessage({
          type: 'DEVICE_REMOVED',
          message: data.message
        });
      } else if (response.status === 401) {
        await this.clearAuth();
      }
      return data;
    } catch (error) {
      console.error('Auth request failed:', error);
      throw error;
    }
  }

  async login(username, password) {
    const deviceId = await this.getDeviceId();
    const result = await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        device_id: deviceId,
        device_name: 'MatchPulse 赛事数据引擎'
      })
    });
    if (result.success && result.token) {
      await this.saveAuth(result.token, result.user);
      if (result.user && result.user.devices_count >= 3) {
        result.warning = '设备数量已达上限（2个），请在账户中心踢出不需要的设备';
      }
    }
    return result;
  }

  async verifyToken() {
    return this.request('/verify', { method: 'POST' });
  }

  async logout() {
    try {
      await this.request('/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout request failed:', error);
    }
    await this.clearAuth();
  }

  async getProfile() {
    return this.request('/profile', { method: 'GET' });
  }

  async removeDevice(deviceId) {
    return this.request('/devices/remove', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
      headers: {
        'X-Device-Id': await this.getDeviceId()
      }
    });
  }
}

const authService = new AuthService();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./models/db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/v1', authRoutes);
app.use('/api/v1/admin', adminRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

initDatabase();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`雷速足球自动提醒后端服务已启动`);
  console.log(`管理面板地址: http://localhost:${PORT}`);
  console.log(`默认管理员账号: admin / admin123`);
  console.log(`用户认证API: http://localhost:${PORT}/api/v1/login`);
});

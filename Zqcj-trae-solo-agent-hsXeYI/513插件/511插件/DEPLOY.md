# 雷速足球自动提醒后端 - 宝塔部署指南

## 服务器信息
- **IP**: 103.146.231.236
- **系统**: CentOS-7.2.1511-x64

---

## 方法一：使用一键部署脚本（推荐）

### 1. 在宝塔面板安装Node.js
1. 登录宝塔面板
2. 点击「软件商店」
3. 搜索「Node.js」
4. 安装 Node.js 16.x 或 18.x 版本

### 2. 上传并运行脚本
1. 将 `deploy.sh` 上传到服务器任意目录
2. SSH连接到服务器
3. 赋予执行权限并运行：
```bash
chmod +x deploy.sh
./deploy.sh
```

### 3. 按照脚本提示操作
脚本会自动完成安装，中间需要你手动上传项目文件

---

## 方法二：手动部署（更可控）

### 步骤1：在宝塔面板安装Node.js
1. 登录宝塔面板
2. 点击「软件商店」
3. 搜索「Node.js」
4. 安装 Node.js 16.x 或 18.x

### 步骤2：创建网站目录
1. 宝塔面板 → 网站 → 添加站点
2. 域名填写：`103.146.231.236`（或你的域名）
3. 数据库：不创建
4. PHP版本：纯静态
5. 根目录：`/www/wwwroot/leisu-backend`

### 步骤3：上传项目文件
将 `backend/` 目录下所有文件上传到 `/www/wwwroot/leisu-backend/`

### 步骤4：SSH连接服务器
```bash
# 进入项目目录
cd /www/wwwroot/leisu-backend

# 安装依赖
npm install --production

# 安装PM2
npm install -g pm2

# 创建日志目录
mkdir -p logs data

# 使用PM2启动服务
pm2 start ecosystem.config.js

# 保存PM2配置
pm2 save

# 设置开机自启
pm2 startup
```

### 步骤5：放行防火墙端口
1. 宝塔面板 → 安全
2. 添加端口规则：`8080`

---

## 访问服务

部署完成后，访问：
- **管理面板**: http://103.146.231.236:8080
- **API地址**: http://103.146.231.236:8080/api/v1

默认管理员账号：
- 用户名: `admin`
- 密码: `admin123`

⚠️ **重要：首次登录请立即修改admin密码！**

---

## 配置反向代理（可选，使用域名访问）

如果想使用域名访问（如 api.yourdomain.com）：

1. 宝塔面板 → 网站 → 你的站点 → 设置
2. 点击「反向代理」
3. 添加反向代理：
   - 代理名称：`leisu-backend`
   - 目标URL：`http://127.0.0.1:8080`
   - 发送域名：`$host`

---

## 更新项目代码

```bash
cd /www/wwwroot/leisu-backend

# 1. 备份数据（重要！）
cp -r data data.backup.$(date +%Y%m%d)

# 2. 上传新代码文件

# 3. 重启服务
pm2 restart leisu-backend
```

---

## PM2常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs leisu-backend

# 重启服务
pm2 restart leisu-backend

# 停止服务
pm2 stop leisu-backend

# 启动服务
pm2 start leisu-backend

# 删除服务
pm2 delete leisu-backend
```

---

## 文件结构

```
/www/wwwroot/leisu-backend/
├── server.js              # 主服务文件
├── package.json           # 项目配置
├── ecosystem.config.js    # PM2配置
├── middleware/
│   └── auth.js           # 认证中间件
├── models/
│   └── db.js             # 数据库操作
├── routes/
│   ├── auth.js           # 用户认证路由
│   └── admin.js          # 管理员路由
├── public/
│   └── index.html        # 管理面板
├── data/                 # 数据目录（自动创建）
│   ├── users.json
│   ├── admins.json
│   └── login_logs.json
└── logs/                 # 日志目录（自动创建）
    ├── error.log
    └── out.log
```

---

## 常见问题

### Q: 服务无法启动？
A: 检查端口8080是否被占用：
```bash
netstat -tulpn | grep 8080
```

### Q: 无法访问？
A: 检查防火墙是否放行8080端口

### Q: 数据丢失？
A: `data/` 目录会自动创建JSON文件，定期备份此目录

### Q: 如何修改端口？
A: 编辑 `server.js` 第12行的 `PORT` 变量，然后重启服务

---

## 插件端配置

部署完成后，修改插件中的API地址：

编辑 `dist_b488693/auth.js`：
```javascript
constructor() {
  this.baseUrl = 'http://103.146.231.236:8080/api/v1';  // 修改为你的服务器地址
  // ...
}
```

#!/bin/bash
# 雷速足球自动提醒后端 - 宝塔一键部署脚本
# 操作系统: CentOS 7.x
# 项目目录: /www/wwwroot/backend

echo "=========================================="
echo "  雷速足球自动提醒后端 - 一键部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}请使用root用户运行此脚本${NC}"
  exit 1
fi

# 项目目录
PROJECT_DIR="/www/wwwroot/backend"

# 检查项目目录是否存在
if [ ! -d "$PROJECT_DIR" ]; then
  echo -e "${RED}项目目录不存在: $PROJECT_DIR${NC}"
  echo -e "${RED}请先通过宝塔上传源码文件到此目录${NC}"
  exit 1
fi

cd "$PROJECT_DIR" || exit 1

echo ""
echo -e "${YELLOW}1. 检查并安装Node.js...${NC}"

# 检查Node.js
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}未检测到Node.js${NC}"
  
  # 检查宝塔Node.js
  if [ -d "/www/server/nodejs" ]; then
    echo -e "${GREEN}检测到宝塔Node.js，正在查找可用版本...${NC}"
    # 查找包含bin/node的目录（真正的Node.js版本）
    NODE_VER=""
    for dir in /www/server/nodejs/*; do
      if [ -d "$dir" ] && [ -f "$dir/bin/node" ]; then
        NODE_VER=$(basename "$dir")
        echo -e "${GREEN}找到Node.js版本: $NODE_VER${NC}"
      fi
    done
    
    if [ -n "$NODE_VER" ]; then
      export PATH="/www/server/nodejs/$NODE_VER/bin:$PATH"
      echo -e "${GREEN}使用宝塔Node.js: $NODE_VER${NC}"
    else
      echo -e "${RED}未找到有效的Node.js版本目录${NC}"
      exit 1
    fi
  else
    echo -e "${YELLOW}未检测到宝塔Node.js，正在安装Node.js 18.x...${NC}"
    
    # 安装Node.js 18.x
    curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
    yum install -y nodejs
    
    if [ $? -ne 0 ]; then
      echo -e "${RED}Node.js安装失败${NC}"
      exit 1
    fi
  fi
fi

if ! command -v node &> /dev/null; then
  echo -e "${RED}Node.js安装失败，请手动安装${NC}"
  exit 1
fi

echo -e "${GREEN}Node.js版本: $(node -v)${NC}"
echo -e "${GREEN}npm版本: $(npm -v)${NC}"

echo ""
echo -e "${YELLOW}2. 检查并安装PM2...${NC}"

if ! command -v pm2 &> /dev/null; then
  echo -e "${YELLOW}未检测到PM2，正在安装...${NC}"
  npm install -g pm2
fi

echo -e "${GREEN}PM2版本: $(pm2 -v)${NC}"

echo ""
echo -e "${YELLOW}3. 安装项目依赖...${NC}"

# 检查package.json
if [ ! -f "package.json" ]; then
  echo -e "${RED}package.json不存在，请确认源码文件是否完整${NC}"
  exit 1
fi

npm install --production

if [ $? -ne 0 ]; then
  echo -e "${RED}依赖安装失败${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}4. 创建必要目录...${NC}"

mkdir -p data logs

echo ""
echo -e "${YELLOW}5. 创建PM2配置文件...${NC}"

cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'leisu-backend',
    script: './server.js',
    cwd: '/www/wwwroot/backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: '/www/wwwroot/backend/logs/error.log',
    out_file: '/www/wwwroot/backend/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
EOF

echo ""
echo -e "${YELLOW}6. 停止旧服务（如果存在）...${NC}"

pm2 delete leisu-backend 2>/dev/null || true

echo ""
echo -e "${YELLOW}7. 启动服务...${NC}"

pm2 start ecosystem.config.js

if [ $? -ne 0 ]; then
  echo -e "${RED}服务启动失败${NC}"
  pm2 logs leisu-backend --lines 20 --nostream
  exit 1
fi

pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo -e "${GREEN}=========================================="
echo -e "${GREEN}  部署完成！"
echo -e "${GREEN}=========================================="
echo ""
echo -e "服务信息："
echo -e "  项目目录: $PROJECT_DIR"
echo -e "  访问地址: http://103.146.231.236:8080"
echo -e "  管理面板: http://103.146.231.236:8080"
echo ""
echo -e "默认管理员账号："
echo -e "  用户名: admin"
echo -e "  密码: admin123"
echo ""
echo -e "常用命令："
echo -e "  查看状态: pm2 status"
echo -e "  查看日志: pm2 logs leisu-backend"
echo -e "  重启服务: pm2 restart leisu-backend"
echo -e "  停止服务: pm2 stop leisu-backend"
echo -e "  启动服务: pm2 start leisu-backend"
echo ""
echo -e "${YELLOW}重要提示："
echo -e "1. 请在宝塔防火墙中放行 8080 端口"
echo -e "2. 首次登录后请立即修改admin密码"
echo -e "3. 如需使用域名，请在宝塔中配置反向代理"
echo ""

# 显示服务状态
pm2 status

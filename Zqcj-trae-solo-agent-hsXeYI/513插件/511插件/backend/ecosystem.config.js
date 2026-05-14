module.exports = {
  apps: [{
    name: 'leisu-backend',
    script: './server.js',
    cwd: '/www/wwwroot/leisu-backend',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: '/www/wwwroot/leisu-backend/logs/error.log',
    out_file: '/www/wwwroot/leisu-backend/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};

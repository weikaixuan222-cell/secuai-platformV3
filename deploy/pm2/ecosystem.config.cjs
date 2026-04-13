const path = require('node:path');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env')
});

const repoRoot = path.resolve(__dirname, '..', '..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apiPort = process.env.API_PORT || '3201';
const webPort = process.env.WEB_PORT || '3200';
const postgresPort = process.env.POSTGRES_PORT || '55432';

module.exports = {
  apps: [
    {
      name: 'secuai-api',
      cwd: repoRoot,
      script: npmExecutable,
      args: 'run start --workspace @secuai/api',
      autorestart: true,
      max_restarts: 5,
      env: {
        HOST: process.env.HOST || '127.0.0.1',
        PORT: apiPort,
        DATABASE_URL:
          process.env.DATABASE_URL ||
          `postgresql://secuai:secuai_dev_password@127.0.0.1:${postgresPort}/secuai`,
        DB_SSL_MODE: process.env.DB_SSL_MODE || 'disable',
        AI_ANALYZER_URL: process.env.AI_ANALYZER_URL || 'http://127.0.0.1:8000',
        AI_ANALYZER_TIMEOUT_MS: process.env.AI_ANALYZER_TIMEOUT_MS || '1500',
        AI_ANALYZER_MAX_RETRIES: process.env.AI_ANALYZER_MAX_RETRIES || '1'
      }
    },
    {
      name: 'secuai-web',
      cwd: repoRoot,
      script: npmExecutable,
      args: 'run start --workspace @secuai/web',
      autorestart: true,
      max_restarts: 5,
      env: {
        HOSTNAME: process.env.HOSTNAME || '127.0.0.1',
        PORT: webPort,
        API_URL: process.env.API_URL || `http://127.0.0.1:${apiPort}`
      }
    }
  ]
};

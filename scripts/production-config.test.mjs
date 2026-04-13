import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveProductionConfig } from './production-config.mjs';

test('未显式传入生产环境变量时应回退到固定端口与本机反向代理默认值', () => {
  const result = resolveProductionConfig({});

  assert.deepEqual(result, {
    apiHost: '127.0.0.1',
    apiPort: '3201',
    webHost: '127.0.0.1',
    webPort: '3200',
    postgresPort: '55432',
    redisPort: '6379',
    databaseUrl: 'postgresql://secuai:secuai_dev_password@127.0.0.1:55432/secuai',
    apiUrl: 'http://127.0.0.1:3201',
    aiAnalyzerUrl: 'http://127.0.0.1:8000',
    dbSslMode: 'disable',
    aiAnalyzerTimeoutMs: '1500',
    aiAnalyzerMaxRetries: '1'
  });
});

test('显式传入生产环境变量时应保留调用方配置', () => {
  const result = resolveProductionConfig({
    HOST: '0.0.0.0',
    API_PORT: '4201',
    HOSTNAME: '0.0.0.0',
    WEB_PORT: '4200',
    POSTGRES_PORT: '5432',
    REDIS_PORT: '6380',
    DATABASE_URL: 'postgresql://demo:secret@127.0.0.1:5432/demo',
    API_URL: 'http://127.0.0.1:4201',
    AI_ANALYZER_URL: 'http://127.0.0.1:18000',
    DB_SSL_MODE: 'require',
    AI_ANALYZER_TIMEOUT_MS: '5000',
    AI_ANALYZER_MAX_RETRIES: '3'
  });

  assert.deepEqual(result, {
    apiHost: '0.0.0.0',
    apiPort: '4201',
    webHost: '0.0.0.0',
    webPort: '4200',
    postgresPort: '5432',
    redisPort: '6380',
    databaseUrl: 'postgresql://demo:secret@127.0.0.1:5432/demo',
    apiUrl: 'http://127.0.0.1:4201',
    aiAnalyzerUrl: 'http://127.0.0.1:18000',
    dbSslMode: 'require',
    aiAnalyzerTimeoutMs: '5000',
    aiAnalyzerMaxRetries: '3'
  });
});

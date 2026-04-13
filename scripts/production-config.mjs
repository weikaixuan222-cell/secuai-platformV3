export function resolveProductionConfig(env = process.env) {
  const apiPort = env.API_PORT || '3201';
  const webPort = env.WEB_PORT || '3200';
  const postgresPort = env.POSTGRES_PORT || '55432';

  return {
    apiHost: env.HOST || '127.0.0.1',
    apiPort,
    webHost: env.HOSTNAME || '127.0.0.1',
    webPort,
    postgresPort,
    redisPort: env.REDIS_PORT || '6379',
    databaseUrl:
      env.DATABASE_URL ||
      `postgresql://secuai:secuai_dev_password@127.0.0.1:${postgresPort}/secuai`,
    apiUrl: env.API_URL || `http://127.0.0.1:${apiPort}`,
    aiAnalyzerUrl: env.AI_ANALYZER_URL || 'http://127.0.0.1:8000',
    dbSslMode: env.DB_SSL_MODE || 'disable',
    aiAnalyzerTimeoutMs: env.AI_ANALYZER_TIMEOUT_MS || '1500',
    aiAnalyzerMaxRetries: env.AI_ANALYZER_MAX_RETRIES || '1'
  };
}

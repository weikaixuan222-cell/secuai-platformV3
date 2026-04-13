export function resolveNextDevServerConfig(env = process.env) {
  return {
    hostname: env.HOSTNAME || '127.0.0.1',
    port: env.PORT || '3200'
  };
}

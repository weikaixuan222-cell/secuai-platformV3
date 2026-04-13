export function resolveNextDevServerConfig(env = process.env) {
  return {
    hostname: env.HOSTNAME || '0.0.0.0',
    port: env.PORT || '3200'
  };
}

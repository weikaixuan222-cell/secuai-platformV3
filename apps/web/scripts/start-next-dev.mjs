import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolveNextDevServerConfig } from './start-next-dev-config.mjs';

const require = createRequire(import.meta.url);
const nextBinPath = require.resolve('next/dist/bin/next');
const { hostname, port } = resolveNextDevServerConfig(process.env);

process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE = '1';

const devProcess = spawn(
  process.execPath,
  [nextBinPath, 'dev', '--hostname', hostname, '--port', port],
  {
    cwd: process.cwd(),
    stdio: 'inherit'
  }
);

try {
  const [exitCode] = await once(devProcess, 'exit');
  process.exit(exitCode ?? 0);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}

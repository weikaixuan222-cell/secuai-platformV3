import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBinPath = require.resolve('next/dist/bin/next');

process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE = '1';

const devProcess = spawn(
  process.execPath,
  [nextBinPath, 'dev', '--hostname', '127.0.0.1', '--port', '3200'],
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

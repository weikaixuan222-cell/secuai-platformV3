import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';

import { resolveNextDevServerConfig } from './start-next-dev-config.mjs';

const require = createRequire(import.meta.url);
const nextBinPath = require.resolve('next/dist/bin/next');
const { hostname, port } = resolveNextDevServerConfig(process.env);

const startProcess = spawn(
  process.execPath,
  [nextBinPath, 'start', '--hostname', hostname, '--port', port],
  {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  }
);

try {
  const [exitCode] = await once(startProcess, 'exit');
  process.exit(exitCode ?? 0);
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}

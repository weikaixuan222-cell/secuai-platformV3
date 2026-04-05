import { spawn } from 'node:child_process';
import { once } from 'node:events';

const WEB_BASE_URL = process.env.SECUAI_WEB_BASE_URL || 'http://127.0.0.1:3200';
const disabledProbeRoute = `/error-boundary-smoke?trigger=1&probeId=disabled-${Date.now()}`;

function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options);
  }

  return spawn('npm', args, options);
}

function launchStartServer(enableProbeRoute) {
  const previousProbeFlag = process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE;

  if (enableProbeRoute) {
    process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE = '1';
  } else {
    delete process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE;
  }

  const serverProcess = spawnNpm(
    ['run', 'start', '--', '--hostname', '127.0.0.1', '--port', '3200'],
    {
      cwd: process.cwd(),
      stdio: 'inherit'
    }
  );

  if (previousProbeFlag === undefined) {
    delete process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE;
  } else {
    process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE = previousProbeFlag;
  }

  return serverProcess;
}

async function stopProcessTree(processRef) {
  if (!processRef || processRef.exitCode !== null || !processRef.pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill',
      ['/PID', String(processRef.pid), '/T', '/F'],
      { stdio: 'ignore' }
    );
    await once(killer, 'exit');
    return;
  }

  processRef.kill('SIGTERM');
  await Promise.race([
    once(processRef, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
}

async function waitForWebReady(serverProcess) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 90000) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`next start exited early with code ${serverProcess.exitCode}`);
    }

    try {
      const response = await fetch(`${WEB_BASE_URL}/login`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until next start is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for next start: ${WEB_BASE_URL}/login`);
}

async function assertProbeRouteDisabled() {
  const response = await fetch(`${WEB_BASE_URL}${disabledProbeRoute}`);

  if (response.status !== 404) {
    throw new Error(
      `Expected disabled probe route to return 404, got ${response.status} for ${disabledProbeRoute}`
    );
  }

  return {
    route: disabledProbeRoute,
    status: response.status
  };
}

async function runBrowserRecoverySmoke() {
  const smokeProcess = spawnNpm(['run', 'smoke:global-error'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  const [exitCode] = await once(smokeProcess, 'exit');

  if (exitCode !== 0) {
    throw new Error(`smoke:global-error failed against next start: exitCode=${exitCode}`);
  }
}

async function main() {
  const disabledServer = launchStartServer(false);
  let disabledCheck;

  try {
    await waitForWebReady(disabledServer);
    disabledCheck = await assertProbeRouteDisabled();
  } finally {
    await stopProcessTree(disabledServer);
  }

  const enabledServer = launchStartServer(true);

  try {
    await waitForWebReady(enabledServer);
    await runBrowserRecoverySmoke();
  } finally {
    await stopProcessTree(enabledServer);
  }

  console.log(JSON.stringify({
    ok: true,
    disabledProbeRoute: disabledCheck,
    enabledProbeRoute: 'verified by smoke:global-error'
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

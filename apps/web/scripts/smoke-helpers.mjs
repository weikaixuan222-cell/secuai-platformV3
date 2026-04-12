import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WINDOWS_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe'
];

const MACOS_BROWSER_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];

const LINUX_BROWSER_COMMANDS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'microsoft-edge-stable'
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForConditionWithAction({
  action,
  check,
  timeoutMs = 20000,
  intervalMs = 100
}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return true;
    }

    await action();

    if (await check()) {
      return true;
    }

    await delay(intervalMs);
  }

  return false;
}

async function getAvailablePort() {
  const server = net.createServer();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve an available local TCP port.');
    }

    return address.port;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function hasPathHint(candidate) {
  return (
    candidate.includes('/') ||
    candidate.includes('\\') ||
    /^[A-Za-z]:[\\/]/.test(candidate) ||
    candidate.startsWith('.')
  );
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommandFromPath(command) {
  const pathValue = process.env.PATH || '';
  const searchDirectories = pathValue.split(path.delimiter).filter(Boolean);
  const pathExtensions =
    process.platform === 'win32'
      ? unique(
          (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
            .split(';')
            .map((extension) => extension.toLowerCase())
        )
      : [''];
  const hasKnownExtension =
    process.platform === 'win32' &&
    pathExtensions.some((extension) => command.toLowerCase().endsWith(extension));
  const candidateNames =
    process.platform === 'win32' && !hasKnownExtension
      ? unique([command, ...pathExtensions.map((extension) => `${command}${extension}`)])
      : [command];

  for (const directory of searchDirectories) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(directory, candidateName);

      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return '';
}

async function resolveExecutable(candidate) {
  if (!candidate) {
    return '';
  }

  if (hasPathHint(candidate)) {
    return (await pathExists(candidate)) ? candidate : '';
  }

  return resolveCommandFromPath(candidate);
}

function getBrowserCandidates() {
  const envCandidate = process.env.SECUAI_CHROME_PATH;

  if (process.platform === 'win32') {
    return unique([
      envCandidate,
      ...WINDOWS_BROWSER_PATHS,
      'chrome.exe',
      'msedge.exe',
      'chromium.exe'
    ]);
  }

  if (process.platform === 'darwin') {
    return unique([
      envCandidate,
      ...MACOS_BROWSER_PATHS,
      ...LINUX_BROWSER_COMMANDS
    ]);
  }

  return unique([envCandidate, ...LINUX_BROWSER_COMMANDS]);
}

export function requireWebSocket() {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Global WebSocket is unavailable in this Node.js runtime.');
  }
}

export async function waitForHttpOk(url, label, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // 使用轮询等待本地服务可用，避免依赖平台特定等待命令。
    }

    await delay(500);
  }

  throw new Error(`${label} is not ready: ${url}`);
}

export async function resolveBrowserPath() {
  for (const candidate of getBrowserCandidates()) {
    const executablePath = await resolveExecutable(candidate);

    if (executablePath) {
      return executablePath;
    }
  }

  throw new Error(
    [
      'Chrome/Edge executable was not found.',
      '可以通过 SECUAI_CHROME_PATH 显式指定浏览器路径，或确保以下命令之一在 PATH 中可用：',
      LINUX_BROWSER_COMMANDS.join(', ')
    ].join(' ')
  );
}

export async function resolveChromeDebugPort(defaultPort, explicitPort = process.env.SECUAI_CHROME_DEBUG_PORT) {
  if (explicitPort !== undefined && explicitPort !== '') {
    const parsedPort = Number(explicitPort);

    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      throw new Error(`Invalid SECUAI_CHROME_DEBUG_PORT: ${explicitPort}`);
    }

    return parsedPort;
  }

  if (defaultPort !== undefined && defaultPort !== null) {
    const occupiedProbe = net.createServer();

    try {
      await new Promise((resolve, reject) => {
        occupiedProbe.once('error', reject);
        occupiedProbe.listen(defaultPort, '127.0.0.1', resolve);
      });

      return defaultPort;
    } catch {
      return getAvailablePort();
    } finally {
      if (occupiedProbe.listening) {
        await new Promise((resolve) => occupiedProbe.close(resolve));
      }
    }
  }

  return getAvailablePort();
}

export async function launchBrowser({ debugPort, profilePrefix }) {
  const executablePath = await resolveBrowserPath();
  const profileDir = await mkdtemp(path.join(tmpdir(), profilePrefix));
  const browserProcess = spawn(
    executablePath,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      'about:blank'
    ],
    {
      stdio: 'ignore',
      detached: process.platform !== 'win32'
    }
  );

  return {
    browserProcess,
    profileDir,
    executablePath
  };
}

export async function stopProcessTree(processRef) {
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

  const processGroupId = -processRef.pid;

  try {
    process.kill(processGroupId, 'SIGTERM');
  } catch {
    processRef.kill('SIGTERM');
  }

  const [result] = await Promise.race([
    once(processRef, 'exit').then(() => ['exit']),
    delay(5000).then(() => ['timeout'])
  ]);

  if (result === 'exit') {
    return;
  }

  try {
    process.kill(processGroupId, 'SIGKILL');
  } catch {
    processRef.kill('SIGKILL');
  }

  await Promise.race([once(processRef, 'exit'), delay(5000)]);
}

export async function cleanupBrowser({ browserProcess, profileDir }) {
  await stopProcessTree(browserProcess);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profileDir, {
        recursive: true,
        force: true
      });
      return;
    } catch (error) {
      if (attempt === 9) {
        throw error;
      }

      await delay(500);
    }
  }
}

export function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options);
  }

  return spawn('npm', args, options);
}

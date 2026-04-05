import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import path from 'node:path';

const buildIdPath = path.join(process.cwd(), '.next', 'BUILD_ID');

function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'npm', ...args], options);
  }

  return spawn('npm', args, options);
}

async function hasProductionBuildId() {
  try {
    await access(buildIdPath);
    return true;
  } catch {
    return false;
  }
}

async function rebuildProductionArtifacts() {
  const buildProcess = spawnNpm(['run', 'build'], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  const [exitCode] = await once(buildProcess, 'exit');

  if (exitCode !== 0) {
    throw new Error(`next build failed before next start: exitCode=${exitCode}`);
  }
}

async function main() {
  if (await hasProductionBuildId()) {
    return;
  }

  console.log(
    '[prepare-next-start] .next/BUILD_ID is missing. Rebuilding production artifacts before next start.'
  );
  await rebuildProductionArtifacts();

  if (!(await hasProductionBuildId())) {
    throw new Error('.next/BUILD_ID is still missing after next build.');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

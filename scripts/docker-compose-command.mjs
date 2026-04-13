import { spawnSync } from 'node:child_process';

function defaultHasCommand(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'ignore',
    shell: false
  });

  return result.status === 0;
}

export function resolveDockerComposeCommand({
  hasCommand = defaultHasCommand
} = {}) {
  if (hasCommand('docker', ['compose', 'version'])) {
    return {
      command: 'docker',
      args: ['compose']
    };
  }

  if (hasCommand('docker-compose', ['version'])) {
    return {
      command: 'docker-compose',
      args: []
    };
  }

  throw new Error(
    '未检测到可用的 Docker Compose 命令。请安装 `docker compose` 插件或 `docker-compose` 二进制后重试。'
  );
}

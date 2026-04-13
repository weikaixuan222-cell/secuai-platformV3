import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDockerComposeCommand } from './docker-compose-command.mjs';

test('存在 docker compose 子命令时应优先使用 Compose v2', () => {
  const result = resolveDockerComposeCommand({
    hasCommand: (command, args) =>
      command === 'docker' && Array.isArray(args) && args.join(' ') === 'compose version'
  });

  assert.deepEqual(result, {
    command: 'docker',
    args: ['compose']
  });
});

test('缺少 docker compose 子命令时应回退到 docker-compose', () => {
  const result = resolveDockerComposeCommand({
    hasCommand: (command) => command === 'docker-compose'
  });

  assert.deepEqual(result, {
    command: 'docker-compose',
    args: []
  });
});

test('两种 Compose 命令都不存在时应给出明确错误', () => {
  assert.throws(
    () => resolveDockerComposeCommand({ hasCommand: () => false }),
    /docker compose|docker-compose/
  );
});

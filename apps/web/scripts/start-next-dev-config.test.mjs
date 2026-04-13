import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveNextDevServerConfig } from './start-next-dev-config.mjs';

test('未显式传入环境变量时应保持本地安全监听地址', () => {
  const result = resolveNextDevServerConfig({});

  assert.deepEqual(result, {
    hostname: '127.0.0.1',
    port: '3200'
  });
});

test('显式传入 HOSTNAME 和 PORT 时应使用调用方提供的值', () => {
  const result = resolveNextDevServerConfig({
    HOSTNAME: '0.0.0.0',
    PORT: '4200'
  });

  assert.deepEqual(result, {
    hostname: '0.0.0.0',
    port: '4200'
  });
});

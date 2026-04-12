import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { resolveChromeDebugPort, waitForConditionWithAction } from './smoke-helpers.mjs';

async function occupyPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

test('resolveChromeDebugPort 在未显式指定端口时应避开已占用端口', async () => {
  const occupiedServer = await occupyPort(9222);

  try {
    const port = await resolveChromeDebugPort(9222);

    assert.notEqual(port, 9222);
    assert.equal(Number.isInteger(port), true);
    assert.equal(port > 0, true);
  } finally {
    await new Promise((resolve) => occupiedServer.close(resolve));
  }
});

test('resolveChromeDebugPort 在显式指定端口时应尊重显式配置', async () => {
  const port = await resolveChromeDebugPort(9222, '9333');
  assert.equal(port, 9333);
});

test('waitForConditionWithAction 应在条件未满足时重复执行动作直到条件成立', async () => {
  let actionCount = 0;

  const result = await waitForConditionWithAction({
    action: async () => {
      actionCount += 1;
    },
    check: async () => actionCount >= 3,
    timeoutMs: 200,
    intervalMs: 1
  });

  assert.equal(result, true);
  assert.equal(actionCount >= 3, true);
});

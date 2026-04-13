import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDelayPolicyRequest } from './dashboard-policies-smoke-helpers.mjs';

test('策略 smoke 应延迟 protection check 请求，确保能观察到 checking 状态', () => {
  assert.equal(
    shouldDelayPolicyRequest('POST', 'http://127.0.0.1:3201/api/v1/protection/check'),
    true
  );
});

test('策略 smoke 应继续延迟策略保存与封禁名单写操作', () => {
  assert.equal(
    shouldDelayPolicyRequest('PUT', 'http://127.0.0.1:3201/api/v1/sites/site-1/security-policy'),
    true
  );
  assert.equal(
    shouldDelayPolicyRequest('POST', 'http://127.0.0.1:3201/api/v1/sites/site-1/blocked-entities'),
    true
  );
  assert.equal(
    shouldDelayPolicyRequest('DELETE', 'http://127.0.0.1:3201/api/v1/blocked-entities/10'),
    true
  );
});

test('策略 smoke 不应无差别延迟无关请求', () => {
  assert.equal(
    shouldDelayPolicyRequest('GET', 'http://127.0.0.1:3201/api/v1/sites'),
    false
  );
  assert.equal(
    shouldDelayPolicyRequest('POST', 'http://127.0.0.1:3201/api/v1/request-logs'),
    false
  );
});

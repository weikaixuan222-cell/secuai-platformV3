import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const eventDetailPagePath = path.join(
  __dirname,
  '..',
  'app',
  'dashboard',
  'events',
  '[id]',
  'page.tsx'
);

test('事件详情页应显式声明 force-dynamic，避免错误边界探针在生产构建期被固化', async () => {
  const pageSource = await readFile(eventDetailPagePath, 'utf8');

  assert.match(
    pageSource,
    /export const dynamic = ['"]force-dynamic['"];/
  );
});

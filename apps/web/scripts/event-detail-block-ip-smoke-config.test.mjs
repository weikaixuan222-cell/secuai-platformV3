import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardEventsSmokePath = path.join(__dirname, 'dashboard-events-smoke.mjs');

test('事件详情 smoke 在点击快速封禁前应等待按钮真正可点击', async () => {
  const scriptSource = await readFile(dashboardEventsSmokePath, 'utf8');

  assert.ok(
    scriptSource.includes(
      "document.querySelector('[data-testid=\"event-detail-block-ip-button\"]')?.disabled === false"
    )
  );
});

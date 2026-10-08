// Browser/IPC wiring check; physical display geometry is covered by Rust tests.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge'});
  try {
    const page = await browser.newPage({viewport: {width: 480, height: 400}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let sequence = 0;
      const callbacks = new Map();
      window.__placements = [];
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
      window.__TAURI_INTERNALS__ = {
        metadata: {currentWindow: {label: 'island'}, currentWebview: {label: 'island'}},
        transformCallback: fn => { const id = ++sequence; callbacks.set(id, fn); return id; },
        unregisterCallback: id => callbacks.delete(id),
        invoke: async (command, args) => {
          if (command === 'plugin:event|listen') return ++sequence;
          if (command === 'set_pill_rect_cmd') window.__placements.push(args);
          if (command === 'poll_notifications') return [];
          if (command === 'get_fullscreen_state') return false;
          if (command === 'get_listener_status') return {available: true, reason: null, message: ''};
          return null;
        },
      };
      localStorage.setItem('dynamic-island.fixed-position.v1', 'false');
      localStorage.setItem('dynamic-island.window-position.v1', JSON.stringify({edge: 'top', docked: false, x: 1575, y: 300}));
    });
    await page.goto('http://127.0.0.1:1420/');
    await page.evaluate(async () => {
      window.__store = (await import('/src/store/islandStore.ts')).useIslandStore;
    });
    await page.getByRole('button', {name: '打开喝水提醒设置'}).click();
    await page.waitForFunction(() => window.__placements.at(-1)?.width === 432);
    const settings = await page.evaluate(() => window.__placements.at(-1));
    assert.deepEqual(settings, {x: 24, y: 0, width: 432, height: 360, keepVisible: true});
    await page.getByRole('button', {name: '关闭喝水提醒设置'}).click();
    await page.waitForFunction(() => window.__placements.at(-1)?.width === 150);
    // A drag temporarily disables boundary correction; release must re-send
    // geometry even though neither the mode nor the size changes.
    await page.evaluate(() => window.__store.getState().setDragging(true));
    await page.waitForFunction(() => window.__placements.at(-1)?.keepVisible === false);
    await page.evaluate(() => window.__store.getState().setDragging(false));
    await page.waitForFunction(() => window.__placements.at(-1)?.keepVisible === true);
    await page.evaluate(() => {
      window.__store.getState().setDocked(true);
      window.__store.getState().setMode('hidden');
    });
    await page.waitForFunction(() => window.__placements.at(-1)?.width === 0);
    assert.equal((await page.evaluate(() => window.__placements.at(-1))).height, 0);
    assert.deepEqual(errors, []);
    console.log('Passed: settings geometry, close, drag/release sync, hidden geometry; no browser errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

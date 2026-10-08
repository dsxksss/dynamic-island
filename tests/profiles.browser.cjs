// Run against `vite --host 127.0.0.1`; uses an isolated browser and mocked Tauri IPC.
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 400 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Only mock wall time; keep animation frames and WAAPI on the same real
    // clock so advancing an hour does not strand an exiting motion element.
    await page.clock.setFixedTime(new Date('2026-10-08T10:00:00'));
    await page.addInitScript(() => {
      let seq = 0;
      const callbacks = new Map();
      const listeners = new Map();
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event, id) => listeners.delete(id),
      };
      window.__emit = (event, payload) => {
        for (const [id, listener] of listeners) {
          if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
        }
      };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'island' }, currentWebview: { label: 'island' } },
        transformCallback: (fn) => { const id = ++seq; callbacks.set(id, fn); return id; },
        unregisterCallback: (id) => callbacks.delete(id),
        invoke: async (cmd, args) => {
          if (cmd === 'plugin:event|listen') { const id = ++seq; listeners.set(id, args); return id; }
          if (cmd === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
          if (cmd === 'get_fullscreen_state') return false;
          if (cmd === 'poll_notifications') return [];
          if (cmd === 'get_listener_status') return { available: true, reason: null, message: '' };
          return null;
        },
      };
      window.__soundNotes = 0;
      const parameter = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
      window.AudioContext = class {
        currentTime = 0;
        destination = {};
        resume() { return Promise.resolve(); }
        createOscillator() { return { frequency: parameter(), connect() {}, disconnect() {}, start() { window.__soundNotes++; }, stop() {} }; }
        createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
      };
      if (!localStorage.getItem('dynamic-island.profiles.v1')) {
        localStorage.setItem('dynamic-island.water-reminder.v2', JSON.stringify({
          enabled: true, startTime: '00:00', endTime: '00:00', intervalMinutes: 20,
          durationSeconds: 30, soundEnabled: true, confirmMethod: 'hold', confirmHoldSeconds: 2,
        }));
      }
    });
    await page.goto('http://127.0.0.1:1420/');
    await page.evaluate(async () => { window.__islandStore = (await import('/src/store/islandStore.ts')).useIslandStore; });
    console.log('Loaded preview');
    await page.getByRole('button', { name: '打开喝水提醒设置' }).click();
    await page.getByRole('button', { name: '游戏配置', exact: true }).click();
    // Edit only the inactive profile. The active reminder countdown must survive.
    const interval = page.getByRole('spinbutton').first();
    await interval.fill('60');
    await interval.blur();
    await page.getByRole('switch', { name: '显示提醒窗口', exact: true }).click();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('dynamic-island.profiles.v1')));
    let value = await saved();
    assert.equal(value.profiles.game.water.intervalMinutes, 60);
    assert.equal(value.profiles.normal.water.intervalMinutes, 20);
    assert.equal(value.profiles.game.water.showPopup, false);
    assert.equal(value.manual, 'normal');
    await page.getByRole('switch', { name: '全屏自动切换', exact: true }).click();
    await page.getByRole('button', { name: '关闭喝水提醒设置' }).click();
    await page.clock.setFixedTime(new Date('2026-10-08T10:20:00'));
    await page.waitForFunction(() => window.__islandStore.getState().queue.length === 1);
    console.log('Checked inactive profile editing and normal reminder');
    let state = await page.evaluate(async () => (await import('/src/store/islandStore.ts')).useIslandStore.getState().queue.length);
    assert.equal(state, 1, 'editing inactive game settings must not delay normal reminder');
    await page.evaluate(() => window.__emit('island://fullscreen', true));
    await page.getByRole('status').filter({ hasText: '已进入游戏模式' }).waitFor();
    state = await page.evaluate(async () => (await import('/src/store/islandStore.ts')).useIslandStore.getState().queue.length);
    assert.equal(state, 0, 'switching profiles must remove the old reminder');
    const notes = await page.evaluate(() => window.__soundNotes);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(() => window.__soundNotes), notes, 'old looping sound must stop');
    await page.clock.setFixedTime(new Date('2026-10-08T11:20:00'));
    await page.waitForFunction((previous) => window.__soundNotes > previous, notes);
    assert.ok(await page.evaluate(() => window.__soundNotes) > notes, 'game sound-only reminder fires after its own interval');
    state = await page.evaluate(async () => (await import('/src/store/islandStore.ts')).useIslandStore.getState().queue.length);
    assert.equal(state, 0, 'sound-only reminder must not enqueue a popup');
    await page.evaluate(() => window.__emit('island://fullscreen', false));
    await page.getByRole('status').filter({ hasText: '已恢复普通模式' }).waitFor();
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__emit('island://top-hover', { hovering: true, overPill: true }));
    await page.getByRole('button', { name: '打开喝水提醒设置' }).click();
    await page.getByRole('switch', { name: '游戏模式', exact: true }).click();
    await page.evaluate(() => window.__emit('island://fullscreen', false));
    value = await saved();
    assert.equal(value.autoFullscreen, false, 'manual switching turns off automatic switching');
    assert.equal(value.manual, 'game');
    await page.reload();
    await page.getByRole('button', { name: '打开喝水提醒设置' }).click();
    assert.match(await page.locator('body').textContent(), /当前使用游戏配置/);
    assert.equal((await saved()).profiles.game.water.intervalMinutes, 60);
    await page.waitForTimeout(500);
    if (process.env.PROFILE_SCREENSHOT) await page.screenshot({ path: process.env.PROFILE_SCREENSHOT });
    assert.deepEqual(errors, []);
    console.log('PASS: independent editing, normal timer, fullscreen transitions, old sound cleanup, sound-only game reminder, manual override, reload');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production migration/validation code with isolated storage.
function loadProfiles(entries = {}) {
  const localStorage = { getItem: (key) => entries[key] ?? null };
  const cache = new Map();
  function load(file) {
    file = path.resolve(__dirname, '..', file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, localStorage, window: { localStorage },
      require: (name) => {
        if (name.endsWith('/tauri')) return {};
        return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name);
      },
    }, { filename: file });
    return exports;
  }
  return { ...load('src/hooks/useReminderProfiles.ts'), ...load('src/lib/profileMode.ts') };
}

test('manual mode wins regardless of fullscreen; automatic mode follows fullscreen', () => {
  const { resolveProfile } = loadProfiles();
  for (const manual of ['normal', 'game']) {
    for (const fullscreen of [false, true]) {
      assert.equal(resolveProfile(false, fullscreen, manual), manual);
      assert.equal(resolveProfile(true, fullscreen, manual), fullscreen ? 'game' : 'normal');
    }
  }
});

test('legacy settings migrate into independent profiles without changing reminder behavior', () => {
  const { readProfiles } = loadProfiles({
    'dynamic-island.water-reminder.v2': JSON.stringify({ enabled: true, startTime: '00:00', endTime: '00:00', intervalMinutes: 37, durationSeconds: 45, confirmMethod: 'hover', soundEnabled: false }),
    'dynamic-island.system-notifications.v2': 'true',
  });
  const saved = readProfiles();
  assert.equal(saved.autoFullscreen, false);
  assert.equal(saved.manual, 'normal');
  for (const profile of Object.values(saved.profiles)) {
    assert.equal(profile.water.intervalMinutes, 37);
    assert.equal(profile.water.durationSeconds, 45);
    assert.equal(profile.water.soundEnabled, false);
    assert.equal(profile.water.showPopup, true);
    assert.equal(profile.water.confirmMethod, 'hover');
    assert.equal(profile.systemNotificationsEnabled, true);
  }
  saved.profiles.game.water.intervalMinutes = 60;
  assert.equal(saved.profiles.normal.water.intervalMinutes, 37);
});

test('reload restores distinct profiles, manual choice, auto switch and popup choice', () => {
  const { readProfiles } = loadProfiles({ 'dynamic-island.profiles.v1': JSON.stringify({
    manual: 'game', autoFullscreen: true,
    profiles: {
      normal: { water: { intervalMinutes: 20, showPopup: true }, systemNotificationsEnabled: true },
      game: { water: { intervalMinutes: 60, showPopup: false, soundEnabled: true }, systemNotificationsEnabled: false },
    },
  }) });
  const saved = readProfiles();
  assert.equal(saved.manual, 'game');
  assert.equal(saved.autoFullscreen, true);
  assert.equal(saved.profiles.normal.water.intervalMinutes, 20);
  assert.equal(saved.profiles.game.water.intervalMinutes, 60);
  assert.equal(saved.profiles.game.water.showPopup, false);
  assert.equal(saved.profiles.normal.systemNotificationsEnabled, true);
  assert.equal(saved.profiles.game.systemNotificationsEnabled, false);
});

test('corrupt profiles fall back to legacy settings; numeric values remain bounded', () => {
  for (const raw of ['null', '{broken']) {
    const saved = loadProfiles({ 'dynamic-island.profiles.v1': raw }).readProfiles();
    assert.equal(saved.profiles.normal.water.intervalMinutes, 20);
  }
  const saved = loadProfiles({ 'dynamic-island.profiles.v1': JSON.stringify({ profiles: {
    game: { water: { intervalMinutes: 999, durationSeconds: -1, startTime: 'bad' } },
  } }) }).readProfiles();
  assert.equal(saved.profiles.game.water.intervalMinutes, 240);
  assert.equal(saved.profiles.game.water.durationSeconds, 5);
  assert.equal(saved.profiles.game.water.startTime, '08:00');
});

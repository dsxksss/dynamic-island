const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/lib/waterHistory.ts'), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
}).outputText;
const library = {};
vm.runInNewContext(source, {exports: library, Date});
const {readWaterHistory, recordWater, waterDays, localDateKey, WATER_HISTORY_KEY, LEGACY_WATER_STATS_KEY} = library;
const now = new Date(2026, 9, 8, 12);
const storage = entries => ({getItem: key => entries[key] ?? null});

test('migrates legacy last-day count once without inventing intervening history', () => {
  const entries = {[LEGACY_WATER_STATS_KEY]: JSON.stringify({date:'2026-10-06', count:5})};
  const history = readWaterHistory(storage(entries), now);
  assert.equal(history.days['2026-10-06'], 5);
  assert.equal(history.trackingSince, '2026-10-08');
  const days = waterDays(history, now);
  assert.equal(days.find(day=>day.date==='2026-10-07').known, false);
  assert.equal(days.at(-1).known, true);
  entries[WATER_HISTORY_KEY] = JSON.stringify(history);
  assert.equal(readWaterHistory(storage(entries), now).days['2026-10-06'], 5);
});

test('counts confirmations by local day and preserves yesterday across midnight and reload', () => {
  let history = readWaterHistory(storage({}), now);
  history = recordWater(history, new Date(2026, 9, 8, 23, 59));
  history = recordWater(history, new Date(2026, 9, 8, 23, 59));
  history = recordWater(history, new Date(2026, 9, 9, 0, 1));
  assert.equal(history.days['2026-10-08'], 2);
  assert.equal(history.days['2026-10-09'], 1);
  const restored = readWaterHistory(storage({[WATER_HISTORY_KEY]:JSON.stringify(history)}), new Date(2026, 9, 9, 1));
  assert.equal(restored.days['2026-10-08'], 2);
  assert.equal(restored.days['2026-10-09'], 1);
});

test('90 local calendar days include leap day and stay unique across DST and year boundaries', () => {
  for (const end of [new Date(2024, 2, 15), new Date(2026, 0, 3), new Date(2026, 10, 10)]) {
    const history = readWaterHistory(storage({}), end);
    const days = waterDays(history, end);
    assert.equal(days.length, 90);
    assert.equal(new Set(days.map(day=>day.date)).size, 90);
    assert.equal(days.at(-1).date, localDateKey(end));
    const first = new Date(end); first.setDate(first.getDate() - 89);
    assert.equal(days[0].date, localDateKey(first));
  }
  assert.ok(waterDays(readWaterHistory(storage({}), new Date(2024,2,15)), new Date(2024,2,15)).some(day=>day.date==='2024-02-29'));
});

test('rejects malformed dates, future records and invalid counts without losing valid data', () => {
  const saved = {version:1, trackingSince:'2026-09-01', days:{'2026-09-31':4,'2026-10-09':8,'2026-10-01':-1,'2026-10-02':2.5,'2026-10-03':'3','2026-10-04':7}};
  const history = readWaterHistory(storage({[WATER_HISTORY_KEY]:JSON.stringify(saved)}), now);
  assert.equal(Object.keys(history.days).length, 1);
  assert.equal(history.days['2026-10-04'], 7);
  assert.equal(waterDays(history, now).find(day=>day.date==='2026-10-05').count, 0);
  assert.equal(waterDays(history, now).find(day=>day.date==='2026-10-05').known, true);
  assert.equal(readWaterHistory({getItem(){throw new Error('unavailable');}}, now).trackingSince, '2026-10-08');
});

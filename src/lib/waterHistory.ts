export const WATER_HISTORY_KEY = "dynamic-island.water-history.v1";
export const LEGACY_WATER_STATS_KEY = "dynamic-island.water-reminder.stats.v1";

export interface WaterHistory {
  version: 1;
  trackingSince: string;
  days: Record<string, number>;
}

export interface WaterDay {
  date: string;
  count: number;
  known: boolean;
  weekday: number;
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateKey(new Date(`${value}T12:00:00`)) === value;
}

export function readWaterHistory(storage: Pick<Storage, "getItem">, now = new Date()): WaterHistory {
  const today = localDateKey(now);
  const history: WaterHistory = { version: 1, trackingSince: today, days: {} };
  try {
    const saved = JSON.parse(storage.getItem(WATER_HISTORY_KEY) ?? "null");
    if (saved?.version === 1 && validDate(saved.trackingSince) && saved.trackingSince <= today && saved.days && typeof saved.days === "object") {
      history.trackingSince = saved.trackingSince;
      for (const [date, count] of Object.entries(saved.days)) {
        if (validDate(date) && date <= today && typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
          history.days[date] = count;
        }
      }
    }
  } catch { /* Keep working when saved data is malformed or unavailable. */ }
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_WATER_STATS_KEY) ?? "null");
    if (validDate(legacy?.date) && legacy.date <= today && Number.isSafeInteger(legacy.count) && legacy.count >= 0) {
      // An older EXE may still have updated its last-day counter. Merge without
      // adding it twice, and do not pretend the missing intervening days exist.
      history.days[legacy.date] = Math.max(history.days[legacy.date] ?? 0, legacy.count);
    }
  } catch { /* Legacy migration is best-effort. */ }
  return history;
}

export function recordWater(history: WaterHistory, now = new Date()): WaterHistory {
  const date = localDateKey(now);
  return { ...history, days: { ...history.days, [date]: (history.days[date] ?? 0) + 1 } };
}

export function waterDays(history: WaterHistory, now = new Date(), length = 90): WaterDay[] {
  const end = new Date(now);
  end.setHours(12, 0, 0, 0);
  return Array.from({ length }, (_, i) => {
    const day = new Date(end);
    day.setDate(day.getDate() - (length - 1 - i));
    const date = localDateKey(day);
    return { date, count: history.days[date] ?? 0, known: date >= history.trackingSince || Object.prototype.hasOwnProperty.call(history.days, date), weekday: (day.getDay() + 6) % 7 };
  });
}

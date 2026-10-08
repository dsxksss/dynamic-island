import type { WaterReminderSettings } from "./types";

const STORAGE_KEY = "dynamic-island.water-reminder.v2";

export const DEFAULT_WATER_REMINDER_SETTINGS: WaterReminderSettings = {
  enabled: false,
  startTime: "08:00",
  endTime: "18:00",
  intervalMinutes: 20,
  durationSeconds: 30,
  confirmHoldSeconds: 2,
  confirmMethod: "hold",
  soundEnabled: true,
  showPopup: true,
};

export function normalizeSettings(
  value: Partial<WaterReminderSettings>,
): WaterReminderSettings {
  const interval = Number(value.intervalMinutes);
  const duration = Number(value.durationSeconds);
  const confirmHold = Number(value.confirmHoldSeconds);
  return {
    enabled: value.enabled === true,
    startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime ?? "")
      ? value.startTime!
      : DEFAULT_WATER_REMINDER_SETTINGS.startTime,
    endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.endTime ?? "")
      ? value.endTime!
      : DEFAULT_WATER_REMINDER_SETTINGS.endTime,
    intervalMinutes: Number.isFinite(interval)
      ? Math.min(240, Math.max(1, Math.round(interval)))
      : DEFAULT_WATER_REMINDER_SETTINGS.intervalMinutes,
    soundEnabled: value.soundEnabled !== false,
    showPopup: value.showPopup !== false,
    durationSeconds: Number.isFinite(duration)
      ? Math.min(300, Math.max(5, Math.round(duration)))
      : DEFAULT_WATER_REMINDER_SETTINGS.durationSeconds,
    confirmHoldSeconds: Number.isFinite(confirmHold)
      ? Math.min(10, Math.max(0, Math.round(confirmHold)))
      : DEFAULT_WATER_REMINDER_SETTINGS.confirmHoldSeconds,
    confirmMethod: value.confirmMethod === "hover" ? "hover" : "hold",
  };
}

export function readSettings(): WaterReminderSettings {
  if (typeof window === "undefined") return DEFAULT_WATER_REMINDER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? normalizeSettings(JSON.parse(raw) as Partial<WaterReminderSettings>)
      : DEFAULT_WATER_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_WATER_REMINDER_SETTINGS;
  }
}

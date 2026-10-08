import { useEffect, useRef, useState } from "react";

import type { WaterReminderSettings } from "../lib/types";
import { startWaterReminderSound } from "../lib/sound";
import { useIslandStore } from "../store/islandStore";
import { LEGACY_WATER_STATS_KEY, WATER_HISTORY_KEY, localDateKey, readWaterHistory, recordWater } from "../lib/waterHistory";

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function atLocalMinute(base: Date, dayOffset: number, minute: number): Date {
  const result = new Date(base);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() + dayOffset);
  result.setMinutes(minute);
  return result;
}

function getWindowForDate(
  base: Date,
  dayOffset: number,
  settings: WaterReminderSettings,
) {
  const startMinute = minutesFromTime(settings.startTime);
  const endMinute = minutesFromTime(settings.endTime);
  const start = atLocalMinute(base, dayOffset, startMinute);
  const end = atLocalMinute(base, dayOffset, endMinute);
  // An end time at or before the start time means the reminder window crosses
  // midnight. Equal times intentionally represent a full 24-hour window.
  if (endMinute <= startMinute) end.setDate(end.getDate() + 1);
  return { start, end };
}

function getActiveWindow(now: Date, settings: WaterReminderSettings) {
  for (const dayOffset of [-1, 0, 1]) {
    const window = getWindowForDate(now, dayOffset, settings);
    if (now >= window.start && now <= window.end) return window;
  }
  return null;
}

function getNextDueAt(now: Date, settings: WaterReminderSettings, anchorAt = now.getTime()): number {
  const anchor = new Date(anchorAt);
  const active = getActiveWindow(anchor, settings);
  if (active) {
    const intervalMs = settings.intervalMinutes * 60_000;
    const next = anchorAt + intervalMs;
    if (next <= active.end.getTime()) return next;
  }

  // If outside the current window, wait until the next local start time.
  for (const dayOffset of [0, 1, 2, 3]) {
    const candidate = getWindowForDate(now, dayOffset, settings).start;
    if (candidate.getTime() > now.getTime()) return candidate.getTime();
  }
  return now.getTime() + settings.intervalMinutes * 60_000;
}

export function useWaterReminder(settings: WaterReminderSettings, profile: string) {
  const [history, setHistory] = useState(() => readWaterHistory({ getItem: (key) => window.localStorage.getItem(key) }));
  const historyRef = useRef(history);
  const [today, setToday] = useState(() => localDateKey());
  const todayCount = history.days[today] ?? 0;
  const confirmedIdRef = useRef<string | null>(null);
  const [nextReminderAt, setNextReminderAt] = useState<number | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const enqueue = useIslandStore((state) => state.enqueue);
  const setMode = useIslandStore((state) => state.setMode);
  const nextDueRef = useRef<number | null>(null);
  const activeRef = useRef<{ id: string; expiresAt: number; visible: boolean } | null>(null);
  const stopSoundRef = useRef<(() => void) | null>(null);
  const stopActiveRef = useRef<() => void>(() => {});
  const remove = useIslandStore((state) => state.remove);

  useEffect(() => {
    const refresh = () => setToday(localDateKey());
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(WATER_HISTORY_KEY, JSON.stringify(history));
      window.localStorage.setItem(LEGACY_WATER_STATS_KEY, JSON.stringify({ date: today, count: todayCount }));
    } catch {
      // Keep session history intact if local storage is unavailable.
    }
  }, [history, today, todayCount]);

  useEffect(() => {
    stopSoundRef.current?.();
    stopSoundRef.current = null;
    if (settings.soundEnabled && activeRef.current) {
      stopSoundRef.current = startWaterReminderSound(activeRef.current.expiresAt);
    }
  }, [settings.soundEnabled]);

  useEffect(() => {
    nextDueRef.current = null;
    setNextReminderAt(null);
    if (!settings.enabled) {
      return;
    }

    let expiryTimer: number | undefined;
    let revealTimer: number | undefined;
    const stopActive = () => {
      window.clearTimeout(expiryTimer);
      window.clearTimeout(revealTimer);
      stopSoundRef.current?.();
      stopSoundRef.current = null;
      const active = activeRef.current;
      activeRef.current = null;
      if (!active) return;
      const state = useIslandStore.getState();
      const wasTop = state.queue[0]?.id === active.id;
      remove(active.id);
      // Expiring water must never close an unrelated notification. Keep the
      // idle pill visible so the next reminder does not require top-edge hover.
      if (wasTop && (state.mode === "card" || state.mode === "compact")) setMode("idle");
    };
    stopActiveRef.current = stopActive;
    const unsubscribe = useIslandStore.subscribe((state) => {
      if (activeRef.current?.visible && !state.queue.some((n) => n.id === activeRef.current?.id)) {
        stopActive();
      }
    });

    const check = () => {
      const current = settingsRef.current;
      if (!current.enabled) return;

      const now = new Date();
      if (activeRef.current && now.getTime() >= activeRef.current.expiresAt) stopActive();
      if (nextDueRef.current === null) {
        nextDueRef.current = getNextDueAt(now, current);
        setNextReminderAt(nextDueRef.current);
      }

      const dueAt = nextDueRef.current;
      if (dueAt === null || now.getTime() < dueAt) return;

      const dueDate = new Date(dueAt);
      const activeWindow = getActiveWindow(now, current);
      // Skip missed slots after sleep; never replay a backlog of old reminders.
      const expiresAt = dueAt + current.durationSeconds * 1000;
      // Keep the current reminder's full duration if intervals overlap.
      if (!activeRef.current && activeWindow && dueAt >= activeWindow.start.getTime() && now.getTime() < expiresAt) {
        stopActive();
        const reminderId = `water-${dueAt}`;
        activeRef.current = { id: reminderId, expiresAt, visible: current.showPopup };
        if (current.showPopup) enqueue({
            id: reminderId,
            appName: "喝水提醒",
            icon: "",
            title: "该喝水了",
            body: `现在是 ${dueDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}，喝一杯水，保持状态。`,
            timestamp: dueAt,
            kind: "timer",
        });
        if (current.soundEnabled) stopSoundRef.current = startWaterReminderSound(expiresAt);

        if (current.showPopup && useIslandStore.getState().mode === "hidden") {
          setMode("idle");
          revealTimer = window.setTimeout(() => setMode("card"), 60);
        } else if (current.showPopup) {
          setMode("card");
        }

        expiryTimer = window.setTimeout(stopActive, Math.max(0, expiresAt - Date.now()));
      }

      nextDueRef.current = getNextDueAt(now, current, dueAt);
      setNextReminderAt(nextDueRef.current);
    };

    check();
    const timer = window.setInterval(check, 1000);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
      stopActive();
      stopActiveRef.current = () => {};
    };
  }, [profile, enqueue, remove, setMode, settings.enabled, settings.endTime, settings.intervalMinutes, settings.startTime]);

  function resetCountdown() {
    const current = settingsRef.current;
    stopActiveRef.current();
    if (!current.enabled) {
      nextDueRef.current = null;
      setNextReminderAt(null);
      return;
    }
    const now = new Date();
    const next = getNextDueAt(now, current, now.getTime());
    nextDueRef.current = next;
    setNextReminderAt(next);
  }

  function confirmWaterReminder(id: string) {
    if (activeRef.current?.id !== id || confirmedIdRef.current === id || typeof window === "undefined") return;
    confirmedIdRef.current = id;
    const now = new Date();
    const updated = recordWater(historyRef.current, now);
    historyRef.current = updated;
    setHistory(updated);
    setToday(localDateKey(now));
  }

  return { settings, history, todayCount, nextReminderAt, confirmWaterReminder, resetCountdown };
}

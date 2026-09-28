// Drive the island lifecycle: poll the backend for real system notifications
// every ~2.5s and surface new ones. The water-reminder surface stays visible
// until the user confirms it or its configured duration expires.

import { useEffect, useRef } from "react";

import {
  getListenerStatus,
  onTopHover,
  pollNotifications,
} from "../lib/tauri";
import { playChime } from "../lib/sound";
import { useIslandStore } from "../store/islandStore";

const COMPACT_DURATION_MS = 5000;
const POLL_INTERVAL_MS = 2500;

let demoSeq = 0;

function waterReminderVisible() {
  return useIslandStore.getState().queue.some((n) => n.id.startsWith("water-"));
}

export function useNotifications(systemNotificationsEnabled: boolean): void {
  const enqueue = useIslandStore((s) => s.enqueue);
  const setStatus = useIslandStore((s) => s.setStatus);
  const setMode = useIslandStore((s) => s.setMode);
  const setOverPill = useIslandStore((s) => s.setOverPill);
  const mode = useIslandStore((s) => s.mode);

  const compactTimer = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setModeRef = useRef(setMode);
  setModeRef.current = setMode;

  function clearCompact() {
    if (compactTimer.current) {
      window.clearTimeout(compactTimer.current);
      compactTimer.current = null;
    }
  }
  function scheduleAutoCollapse() {
    clearCompact();
    compactTimer.current = window.setTimeout(() => {
      if (waterReminderVisible()) return;
      // Auto-hide after the countdown — goes straight to hidden (slide away).
      // Only auto-collapses the medium card; the expanded list stays until the
      // user leaves.
      if (modeRef.current === "card" || modeRef.current === "compact") {
        setModeRef.current("hidden");
      }
    }, COMPACT_DURATION_MS);
  }
  // Browser preview follows the current product surface: show the water
  // reminder card instead of the retired generic notification examples.
  function surfaceDemoWaterReminder() {
    const id = `water-demo-${Date.now()}-${demoSeq++}`;
    enqueue({
      id,
      appName: "喝水提醒",
      icon: "",
      title: "该喝水了",
      body: "长按提醒窗口任意位置 2 秒，注满水杯确认已喝水",
      timestamp: Date.now(),
      kind: "timer",
    });
    if (modeRef.current === "hidden") {
      setMode("idle");
      window.setTimeout(() => setMode("card"), 60);
    } else {
      setMode("card");
    }
  }

  // --- initial status pull --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    getListenerStatus().then((s) => {
      if (s && !cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  // --- re-schedule auto-collapse when re-entering compact (e.g. after the
  //     user leaves an expanded view) so the progress bar restarts ----------
  useEffect(() => {
    if (mode === "card" || mode === "compact") {
      scheduleAutoCollapse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // --- notification polling -------------------------------------------------
  useEffect(() => {
    if (!systemNotificationsEnabled) {
      clearCompact();
      // Remove only system messages; preserve the independent water reminder.
      const state = useIslandStore.getState();
      const queue = state.queue.filter((n) => n.id.startsWith("water-"));
      useIslandStore.setState({ queue, mode: queue.length ? "card" : "idle" });
      return;
    }

    if ("__TAURI_INTERNALS__" in window) {
      let cancelled = false;
      let pending = false;
      let revealTimer: number | undefined;
      // Real polling: ask the backend for new system notifications.
      const poll = () => {
        if (cancelled || pending) return;
        pending = true;
        pollNotifications().then((list) => {
          // An IPC request can finish after the switch was turned off.
          if (cancelled) return;
          if (list.length > 0) {
            for (const n of list) enqueue(n);
            playChime();
            // Go straight to expanded (no compact intermediate). If hidden, step
            // through idle briefly so the morph is a smooth height growth.
            if (modeRef.current === "hidden") {
              setMode("idle");
              revealTimer = window.setTimeout(() => {
                if (!cancelled) setMode("card");
              }, 60);
            } else {
              setMode("card");
            }
            scheduleAutoCollapse();
          }
        }).catch((error) => {
          if (!cancelled) console.error("Failed to poll system notifications", error);
        }).finally(() => { pending = false; });
      };
      poll();
      const id = window.setInterval(poll, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        window.clearInterval(id);
        window.clearTimeout(revealTimer);
        clearCompact();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemNotificationsEnabled, enqueue, setMode]);

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) return;

    // Browser dev: show the current water-reminder surface every 12s.
    surfaceDemoWaterReminder();
    const id = window.setInterval(() => {
      surfaceDemoWaterReminder();
    }, 12000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueue, setMode]);

  // --- top hover / over-pill events ----------------------------------------
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    onTopHover(({ hovering, overPill }) => {
      setOverPill(overPill);
      if (hovering) {
        // Cursor in the top summon zone — reveal (if hidden) and stay.
        if (modeRef.current === "hidden") setMode("idle");
      }
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode, setOverPill]);
}

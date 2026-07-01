// Drive the island lifecycle: poll the backend for real system notifications
// every ~2.5s, surface new ones, and run the auto-hide / hover-reveal state
// machine.

import { useEffect, useRef } from "react";

import {
  getListenerStatus,
  onTopHover,
  pollNotifications,
} from "../lib/tauri";
import { useIslandStore } from "../store/islandStore";

const COMPACT_DURATION_MS = 5500;
const IDLE_HIDE_DELAY_MS = 4000;
const INITIAL_VISIBLE_MS = 3500;
const POLL_INTERVAL_MS = 2500;

// Demo feed (only used when not in Tauri — i.e. browser dev).
const DEMO_APPS = [
  { app: "微信", title: "小王", body: "晚上一起吃饭吗？记得叫上小李" },
  { app: "Outlook", title: "周会提醒", body: "项目同步会议将在 10 分钟后开始" },
  { app: "GitHub", title: "PR review", body: "alice requested your review on #142" },
];
let demoSeq = 0;

export function useNotifications(): void {
  const enqueue = useIslandStore((s) => s.enqueue);
  const setStatus = useIslandStore((s) => s.setStatus);
  const setMode = useIslandStore((s) => s.setMode);
  const setOverPill = useIslandStore((s) => s.setOverPill);
  const mode = useIslandStore((s) => s.mode);

  const compactTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setModeRef = useRef(setMode);
  setModeRef.current = setMode;

  function clearHide() {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }
  function clearCompact() {
    if (compactTimer.current) {
      window.clearTimeout(compactTimer.current);
      compactTimer.current = null;
    }
  }
  function scheduleAutoCollapse() {
    clearCompact();
    compactTimer.current = window.setTimeout(() => {
      if (modeRef.current === "compact") {
        setModeRef.current("idle");
        scheduleAutoHide();
      }
    }, COMPACT_DURATION_MS);
  }
  function scheduleAutoHide() {
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      if (modeRef.current === "idle") setModeRef.current("hidden");
      else if (modeRef.current === "compact") scheduleAutoHide();
    }, IDLE_HIDE_DELAY_MS);
  }

  function surfaceNewNotification(app: string, title: string, body: string) {
    enqueue({
      id: `n-${Date.now()}-${demoSeq++}`,
      appName: app,
      title,
      body,
      timestamp: Date.now(),
      kind: "generic" as const,
    });
    clearHide();
    setMode("compact");
    scheduleAutoCollapse();
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

  // --- initial auto-hide ----------------------------------------------------
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (modeRef.current === "idle") setModeRef.current("hidden");
    }, INITIAL_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, []);

  // --- notification polling -------------------------------------------------
  useEffect(() => {
    const inTauri = "__TAURI_INTERNALS__" in window;

    if (inTauri) {
      // Real polling: ask the backend for new system notifications.
      const poll = () => {
        pollNotifications().then((list) => {
          if (list.length > 0) {
            for (const n of list) enqueue(n);
            clearHide();
            setMode("compact");
            scheduleAutoCollapse();
          }
        });
      };
      poll();
      const id = window.setInterval(poll, POLL_INTERVAL_MS);
      return () => window.clearInterval(id);
    }

    // Browser dev: demo feed every 12s.
    const pick = DEMO_APPS[demoSeq % DEMO_APPS.length];
    demoSeq++;
    surfaceNewNotification(pick.app, pick.title, pick.body);
    const id = window.setInterval(() => {
      const p = DEMO_APPS[demoSeq % DEMO_APPS.length];
      demoSeq++;
      surfaceNewNotification(p.app, p.title, p.body);
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
        clearHide();
        if (modeRef.current === "hidden") setMode("idle");
      } else if (!overPill) {
        if (modeRef.current === "idle" || modeRef.current === "hidden") {
          scheduleAutoHide();
        }
      }
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMode, setOverPill]);
}

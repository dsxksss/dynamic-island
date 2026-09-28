// The Dynamic Island — Apple-style.
//
// Design:
//  - The OS window is FIXED size (480×260) and always on top, flush at the
//    screen's top-center (y=0).
//  - The pill is a single element that MORPHS (width/height/borderRadius) with a
//    taut spring — never swapped, never resized by the OS.
//  - `hidden` is a THIN sliver hugging the top edge (a "notch"), only ~8px tall
//    and full-ish width — minimal screen real estate, always visible.
//  - Hovering the screen top (detected by the backend cursor watcher) morphs the
//    sliver into the full pill (idle), which then behaves normally.
//  - Clicking the pill toggles compact<->expanded (notification details).

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";

import { setClickThrough, setPillRect, setWindowFocusable } from "../lib/tauri";
import type { IslandMode } from "../lib/types";
import { useIslandStore } from "../store/islandStore";
import { IdlePill } from "./IdlePill";
import { NotificationList } from "./NotificationList";
import { NotificationView } from "./NotificationView";
import { WaterReminderPanel } from "./WaterReminderPanel";
import { WaterReminderView } from "./WaterReminderView";
import type { WaterReminderSettings } from "../lib/types";

const MORPH_SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;
const SLIDE_SPRING = { type: "spring", stiffness: 300, damping: 28 } as const;

const WIN_W = 480;
const WIN_H = 400;

interface DynamicIslandProps {
  waterReminder: WaterReminderSettings;
  onWaterReminderChange: (patch: Partial<WaterReminderSettings>) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onTestWaterSound: () => void;
  onWaterReminderConfirmed: (id: string) => void;
  todayWaterCount: number;
  nextWaterReminderAt: number | null;
  onResetWaterCountdown: () => void;
}

/** Pill geometry per mode.
 *  `card` = medium single-notification card. `expanded` = large list card. */
function pillGeometry(mode: IslandMode) {
  switch (mode) {
    case "hidden":
      return { width: 150, height: 8, radius: 999 };
    case "idle":
      return { width: 150, height: 38, radius: 999 };
    case "compact":
      return { width: 360, height: 60, radius: 30 };
    case "card":
      // medium card: one notification, icon + title + body
      return { width: 380, height: 130, radius: 28 };
    case "expanded":
      // large list card: all notifications, scrollable
      return { width: 432, height: 320, radius: 34 };
  }
}

/** The pill's top sits this far below the window's top edge. Always flush: the
 *  pill grows DOWNWARD from the top so the notch and the expanded view share the
 *  same top anchor (no vertical jump when morphing). */
const PILL_TOP = 0;

export function DynamicIsland({
  waterReminder,
  onWaterReminderChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onTestWaterSound,
  onWaterReminderConfirmed,
  todayWaterCount,
  nextWaterReminderAt,
  onResetWaterCountdown,
}: DynamicIslandProps) {
  const mode = useIslandStore((s) => s.mode);
  const setMode = useIslandStore((s) => s.setMode);
  const dismiss = useIslandStore((s) => s.dismiss);
  const clearAll = useIslandStore((s) => s.clearAll);
  const queue = useIslandStore((s) => s.queue);
  const overPill = useIslandStore((s) => s.overPill);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const g = settingsOpen
    ? { width: 432, height: 360, radius: 34 }
    : pillGeometry(mode);

  // When the queue becomes empty (e.g. after dismissing the last notification),
  // collapse back to the hidden notch.
  useEffect(() => {
    if (!settingsOpen && queue.length === 0 && (mode === "expanded" || mode === "card" || mode === "compact")) {
      setMode("hidden");
    }
  }, [queue.length, mode, setMode, settingsOpen]);

  // Click-through strategy. The OS window is 480×400 but mostly transparent.
  // Only the ACTUAL PILL should capture clicks; the transparent surround must
  // pass clicks through to apps below.
  //   - expanded (full list): the pill fills most of the window → always
  //     interactive (it's big enough that overPill would be flaky at the edges).
  //   - card/idle/compact (small pill): interactive ONLY when the cursor is
  //     directly over the pill (`overPill`, tracked by the backend watcher).
  //     Otherwise the transparent area would block the desktop.
  //   - hidden (notch): always click-through.
  const visible = settingsOpen || mode !== "hidden";
  const interactive = settingsOpen || (visible && overPill);
  useEffect(() => {
    void setClickThrough(!interactive).catch(console.error);
  }, [interactive]);

  useEffect(() => {
    void setWindowFocusable(settingsOpen).catch(console.error);
    return () => { void setWindowFocusable(false).catch(console.error); };
  }, [settingsOpen]);

  // Sync the pill's on-screen rect to the backend (for hit-testing while
  // click-through). Add a small padding so hover is forgiving at the edges,
  // especially when sliding in from the top.
  useEffect(() => {
    // Never retain the large settings footprint after closing it.
    useIslandStore.getState().setOverPill(false);
    void setPillRect((WIN_W - g.width) / 2, PILL_TOP,
      visible ? g.width : 0, visible ? g.height : 0).catch(console.error);
  }, [g.width, g.height, visible, settingsOpen]);

  // Click: card -> expanded (open the full list); expanded -> card.
  function handleClick() {
    if (settingsOpen) return;
    if (modeRef.current === "expanded") setMode("card");
    else if (modeRef.current === "card" && queue[0]?.kind === "timer") return;
    else if (modeRef.current === "card" && queue.length > 0) setMode("expanded");
    else if (modeRef.current === "idle" && queue.length > 0) setMode("card");
    else if (modeRef.current === "idle") onOpenSettings();
  }
  // DOM hover handlers are intentionally minimal — the backend cursor watcher
  // (onTopHover) is the single authority for show/hide to avoid feedback loops.
  // We only use mouseenter to eagerly open the card when hovering the idle pill.
  function handleEnter() {
    if (settingsOpen) return;
    if (queue.length > 0 && modeRef.current === "idle") setMode("card");
  }

  return (
    <div
      className="relative"
      style={{ width: WIN_W, height: WIN_H, overflow: "hidden" }}
    >
      <div className="flex h-full w-full justify-center">
        {/* Wrapper anchors the pill's top at a fixed point; the pill morphs in
            place (growing downward), so the notch and the expanded view share
            the same top — no vertical jump. */}
        <motion.div
          animate={{ y: PILL_TOP }}
          transition={SLIDE_SPRING}
          style={{ width: WIN_W }}
          className="absolute top-0 flex justify-center"
        >
          {/* The pill. Morphs width/height/borderRadius + fades out when hidden. */}
          <motion.div
            onClick={handleClick}
            onMouseEnter={handleEnter}
            animate={{
              width: g.width,
              height: g.height,
              borderRadius: g.radius,
              opacity: !settingsOpen && mode === "hidden" ? 0 : 1,
              y: !settingsOpen && mode === "hidden" ? -20 : 0,
            }}
            transition={MORPH_SPRING}
            style={{
              backgroundColor: "rgba(8, 8, 10, 0.96)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              boxShadow:
                "0 10px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.08) inset",
            }}
            className="relative overflow-hidden ring-1 ring-white/10"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {settingsOpen ? (
                <motion.div
                  key="water-settings"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="h-full w-full"
                >
                  <WaterReminderPanel
                    settings={waterReminder}
                    onChange={onWaterReminderChange}
                    todayCount={todayWaterCount}
                    nextReminderAt={nextWaterReminderAt}
                    onResetCountdown={onResetWaterCountdown}
                    onClose={() => {
                      void setClickThrough(true).catch(console.error);
                      useIslandStore.getState().setOverPill(false);
                      // A reminder can arrive while this panel is open. Keep
                      // it visible when the user closes settings so they do
                      // not need to summon the island again from the top edge.
                      setMode(queue[0]?.kind === "timer" ? "card" : "hidden");
                      onCloseSettings();
                    }}
                    onTestSound={onTestWaterSound}
                  />
                </motion.div>
              ) : mode === "hidden" ? (
                <motion.div key="notch" className="h-full w-full" />
              ) : mode === "expanded" ? (
                <motion.div
                  key="list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full w-full"
                >
                  <NotificationList
                    items={queue}
                    onDismiss={dismiss}
                    onClearAll={clearAll}
                  />
                </motion.div>
              ) : mode === "card" && queue[0] ? (
                <motion.div
                  key={`card-${queue[0].id}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full w-full"
                >
                  {queue[0].kind === "timer" ? (
                    <WaterReminderView
                      n={queue[0]}
                      soundEnabled={waterReminder.soundEnabled}
                      onConfirmed={() => {
                        onWaterReminderConfirmed(queue[0].id);
                        dismiss(queue[0].id);
                      }}
                    />
                  ) : (
                    <NotificationView
                      n={queue[0]}
                      expanded
                      onDismiss={() => dismiss(queue[0].id)}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full w-full"
                >
                  <IdlePill onOpenSettings={onOpenSettings} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* System notifications use a five-second auto-close countdown.
                Keep it out of the settings surface, and never show it for
                the water reminder card whose timeout is handled separately. */}
            {!settingsOpen && mode === "card" && queue[0]?.kind === "generic" && (
              <motion.div
                key="progress"
                className="absolute bottom-0 left-3 right-3 h-[2px] overflow-hidden rounded-full bg-white/10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
              >
                <motion.div
                  className="h-full rounded-full bg-white/30"
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: 5, ease: "linear" }}
                />
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

// The Dynamic Island — Apple-style.
//
// Design:
//  - The OS window is FIXED size (480×400) and always on top. It starts at the
//    top-center and can optionally be dragged to the nearest screen edge.
//  - The pill is a single element that MORPHS (width/height/borderRadius) with a
//    taut spring — never swapped, never resized by the OS.
//  - `hidden` is a THIN sliver hugging the top edge (a "notch"), only ~8px tall
//    and full-ish width — minimal screen real estate, always visible.
//  - Hovering the screen top (detected by the backend cursor watcher) morphs the
//    sliver into the full pill (idle), which then behaves normally.
//  - Clicking the pill toggles compact<->expanded (notification details).

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AnimatePresence, motion } from "motion/react";

import {
  setInteractionLock,
  onIslandMoved,
  setPillRect,
  setWindowFocusable,
  readSavedIslandPosition,
  saveIslandPosition,
  snapWindowToNearestEdge,
  setNativeDragTracking,
  onDragReleased,
  startWindowDragging,
  type SnapEdge,
} from "../lib/tauri";
import type { IslandMode } from "../lib/types";
import { useIslandStore } from "../store/islandStore";
import { IdlePill } from "./IdlePill";
import { NotificationList } from "./NotificationList";
import { NotificationView } from "./NotificationView";
import type { ReminderProfilesController } from "../hooks/useReminderProfiles";
import { ModeTransition } from "./ModeTransition";
import { WaterReminderPanel } from "./WaterReminderPanel";
import { WaterReminderView } from "./WaterReminderView";
import type { WaterReminderSettings } from "../lib/types";
import type { WaterHistory } from "../lib/waterHistory";

const MORPH_SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;
const SLIDE_SPRING = { type: "spring", stiffness: 300, damping: 28 } as const;

const WIN_W = 480;
const WIN_H = 400;

interface DynamicIslandProps {
  waterReminder: WaterReminderSettings;
  profiles: ReminderProfilesController;
  fixedPosition: boolean;
  onFixedPositionChange: (fixed: boolean) => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onTestWaterSound: () => void;
  onWaterReminderConfirmed: (id: string) => void;
  todayWaterCount: number;
  waterHistory: WaterHistory;
  nextWaterReminderAt: number | null;
  onResetWaterCountdown: () => void;
}

/** Pill geometry per mode.
 *  `card` = medium single-notification card. `expanded` = large list card. */
function pillGeometry(mode: IslandMode, availableWidth: number) {
  const width = (desired: number) => Math.max(1, Math.min(desired, availableWidth - 16));
  switch (mode) {
    case "hidden":
      return { width: width(150), height: 8, radius: 999 };
    case "idle":
      return { width: width(150), height: 38, radius: 999 };
    case "compact":
      return { width: width(360), height: 60, radius: 30 };
    case "card":
      // medium card: one notification, icon + title + body
      return { width: width(380), height: 130, radius: 28 };
    case "expanded":
      // large list card: all notifications, scrollable
      return { width: width(432), height: 320, radius: 34 };
  }
}

/** The pill's top sits this far below the window's top edge. Always flush: the
 *  pill grows DOWNWARD from the top so the notch and the expanded view share the
 *  same top anchor (no vertical jump when morphing). */
const PILL_TOP = 0;

function useViewportSize() {
  const [size, setSize] = useState(() => ({
    width: typeof window === "undefined" ? WIN_W : window.innerWidth,
    height: typeof window === "undefined" ? WIN_H : window.innerHeight,
  }));

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
}

export function DynamicIsland({
  waterReminder,
  profiles,
  fixedPosition,
  onFixedPositionChange,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  onTestWaterSound,
  onWaterReminderConfirmed,
  todayWaterCount,
  waterHistory,
  nextWaterReminderAt,
  onResetWaterCountdown,
}: DynamicIslandProps) {
  const viewport = useViewportSize();
  const layoutWidth = Math.max(1, viewport.width || WIN_W);
  const layoutHeight = Math.max(1, viewport.height || WIN_H);
  const mode = useIslandStore((s) => s.mode);
  const setMode = useIslandStore((s) => s.setMode);
  const dismiss = useIslandStore((s) => s.dismiss);
  const clearAll = useIslandStore((s) => s.clearAll);
  const queue = useIslandStore((s) => s.queue);
  const overPill = useIslandStore((s) => s.overPill);
  const [snapEdge, setSnapEdge] = useState<SnapEdge>(
    () => readSavedIslandPosition()?.edge ?? "top",
  );
  const dragging = useIslandStore((s) => s.dragging);
  const setDragging = useIslandStore((s) => s.setDragging);
  const docked = useIslandStore((s) => s.docked);
  const setDocked = useIslandStore((s) => s.setDocked);
  const dragPlacementRef = useRef<{ edge: SnapEdge; pill: { x: number; y: number; width: number; height: number } } | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    setSnapEdge(fixedPosition ? "top" : (readSavedIslandPosition()?.edge ?? "top"));
    setDocked(fixedPosition || (readSavedIslandPosition()?.docked ?? false));
  }, [fixedPosition, setDocked]);

  const showTransition = !!profiles.transition && !settingsOpen && !dragging;
  const g = settingsOpen
    ? { width: Math.max(1, Math.min(432, layoutWidth - 16)), height: 360, radius: 34 }
    : showTransition ? { width: Math.min(300, layoutWidth - 16), height: 66, radius: 28 }
    : pillGeometry(mode, layoutWidth);

  function finishWindowDrag() {
    pendingDragRef.current = null;
    // Clear the backend flag even if React already finished the local drag.
    // This makes the release event idempotent and prevents stale tracking
    // from affecting the next interaction.
    void setNativeDragTracking(false).catch(console.error);
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const placement = dragPlacementRef.current;
    dragPlacementRef.current = null;
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 250);
    if (!placement) {
      setDragging(false);
      return;
    }
    // Keep hiding suspended until the final native position has been saved.
    void snapWindowToNearestEdge(placement.edge, placement.pill)
      .then((position) => {
        // Rust follows the native origin directly; only layout changes need
        // a new client-relative rectangle from React.
        saveIslandPosition(position);
        setDocked(position.docked);
        setSnapEdge(position.edge);
      })
      .catch((error) => {
        setDocked(false);
        console.error("Failed to finish positioning the island window", error);
      })
      .finally(() => setDragging(false));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      fixedPosition ||
      showTransition ||
      dragging ||
      settingsOpen ||
      mode === "expanded" ||
      (mode === "card" && queue[0]?.kind === "timer") ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest?.("button, input, textarea, select")) return;
    pendingDragRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pendingDragRef.current;
    if (!start || draggingRef.current) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance < 6) return;

    pendingDragRef.current = null;
    draggingRef.current = true;
    dragPlacementRef.current = {
      edge: snapEdge,
      pill: {
        x: snapEdge === "left" ? 0 : snapEdge === "right" ? layoutWidth - g.width : (layoutWidth - g.width) / 2,
        y: snapEdge === "bottom" ? layoutHeight - g.height : snapEdge === "top" ? PILL_TOP : (layoutHeight - g.height) / 2,
        width: g.width,
        height: g.height,
      },
    };
    setDragging(true);
    void setInteractionLock(true)
      .then(() => draggingRef.current ? setNativeDragTracking(true) : undefined)
      .then(() => draggingRef.current ? startWindowDragging() : undefined)
      .catch((error) => {
        console.error("Failed to start dragging the island window", error);
        finishWindowDrag();
      });
  }

  useEffect(() => {
    const finish = () => finishWindowDrag();
    // Windows may cancel WebView pointer capture when native dragging STARTS.
    // Only global button release (or pointerup) ends an active native drag.
    const cancel = () => { pendingDragRef.current = null; };
    let disposed = false;
    let unlisten: (() => void) | undefined;
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    onDragReleased(finish).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      unlisten?.();
    };
  }, []);

  // Native Windows dragging fires blur as soon as the drag starts. Persist the
  // actual position from move events instead of treating that blur as release.
  useEffect(() => {
    if (fixedPosition) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onIslandMoved(({ x, y }) => {
      const saved = readSavedIslandPosition();
      const state = useIslandStore.getState();
      saveIslandPosition({ edge: saved?.edge ?? snapEdge, docked: !state.dragging && (saved?.docked ?? state.docked), x, y });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [fixedPosition, snapEdge]);

  // When the queue becomes empty, return to the visible idle pill. The current
  // reminder flow must never require moving the pointer to the screen edge.
  useEffect(() => {
    if (!settingsOpen && queue.length === 0 && (mode === "expanded" || mode === "card" || mode === "compact")) {
      setMode("idle");
    }
  }, [queue.length, mode, setMode, settingsOpen]);

  // Keep the idle pill visible briefly after a reminder/notification closes,
  // then return to the hidden notch when there is nothing to show. Opening the
  // settings panel cancels this timer so the panel stays available.
  useEffect(() => {
    if (settingsOpen || dragging || !docked || overPill || mode !== "idle" || queue.length > 0) return;
    const timer = window.setTimeout(() => {
      if (!pendingDragRef.current && !draggingRef.current) setMode("hidden");
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [mode, queue.length, setMode, settingsOpen, dragging, docked, overPill]);

  // Rust owns click-through and tests against the live native position.
  // React only locks interaction while dragging or editing settings; hover
  // events are informational and cannot overwrite native interaction state.
  const visible = settingsOpen || showTransition || mode !== "hidden";
  useEffect(() => {
    void setInteractionLock(dragging || settingsOpen).catch(console.error);
  }, [dragging, settingsOpen]);

  useEffect(() => {
    void setWindowFocusable(settingsOpen).catch(console.error);
    return () => { void setWindowFocusable(false).catch(console.error); };
  }, [settingsOpen]);

  // Sync the pill's on-screen rect to the backend (for hit-testing while
  // click-through). Add a small padding so hover is forgiving at the edges,
  // especially when sliding in from the top.
  useEffect(() => {
    const x = snapEdge === "left" ? 0 : snapEdge === "right" ? layoutWidth - g.width : (layoutWidth - g.width) / 2;
    const y = snapEdge === "bottom" ? layoutHeight - g.height : snapEdge === "top" ? PILL_TOP : (layoutHeight - g.height) / 2;
    // Fit the expanded content on its display without constraining a native
    // drag. Re-send on release even if neither size nor layout anchor changed.
    void setPillRect(x, y, visible ? g.width : 0, visible ? g.height : 0, !dragging).catch(console.error);
  }, [g.width, g.height, layoutHeight, layoutWidth, visible, settingsOpen, snapEdge, dragging]);

  const edgeLayout = {
    top: "absolute inset-x-0 top-0 flex h-full w-full items-start justify-center",
    right: "absolute inset-y-0 right-0 flex h-full w-full items-center justify-end",
    bottom: "absolute inset-x-0 bottom-0 flex h-full w-full items-end justify-center",
    left: "absolute inset-y-0 left-0 flex h-full w-full items-center justify-start",
  }[snapEdge];
  const hiddenOffset = {
    top: { x: 0, y: -20 },
    right: { x: 20, y: 0 },
    bottom: { x: 0, y: 20 },
    left: { x: -20, y: 0 },
  }[snapEdge];
  const transformOrigin = {
    top: "center top",
    right: "right center",
    bottom: "center bottom",
    left: "left center",
  }[snapEdge];

  // Click: card -> expanded (open the full list); expanded -> card.
  function handleClick() {
    if (showTransition) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
    if (showTransition) return;
    if (settingsOpen) return;
    if (queue.length > 0 && modeRef.current === "idle") setMode("card");
  }

  return (
    <div
      className="relative"
      style={{ width: layoutWidth, height: layoutHeight, overflow: "hidden" }}
    >
      <div className="flex h-full w-full justify-center">
        {/* The wrapper keeps the pill attached to the selected screen edge so
            width/height morphing expands inward from that edge. */}
        <motion.div
          transition={SLIDE_SPRING}
          style={{ width: layoutWidth, height: layoutHeight }}
          className={edgeLayout}
        >
          {/* The pill. Morphs width/height/borderRadius + fades out when hidden. */}
          <motion.div
            onClick={handleClick}
            onMouseEnter={handleEnter}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishWindowDrag}
            onPointerCancel={() => { pendingDragRef.current = null; }}
            animate={{
              width: g.width,
              height: g.height,
              borderRadius: g.radius,
              opacity: !visible ? 0 : 1,
              x: !visible ? hiddenOffset.x : 0,
              y: !visible ? hiddenOffset.y : 0,
            }}
            transition={MORPH_SPRING}
            style={{
              transformOrigin,
              // Keep the pill edge fully opaque and free of the translucent
              // ring/backdrop halo that becomes visible on bright wallpapers.
              backgroundColor: "rgb(8, 8, 10)",
              boxShadow: "none",
            }}
            className={`relative overflow-hidden ${fixedPosition ? "" : dragging ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {showTransition ? (
                <ModeTransition key={`mode-${profiles.transition}`} mode={profiles.transition!} />
              ) : settingsOpen ? (
                <motion.div
                  key="water-settings"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.18 }}
                  className="h-full w-full"
                >
                  <WaterReminderPanel
                    key={profiles.editing}
                    profiles={profiles}
                    settings={profiles.profiles[profiles.editing].water}
                    onChange={(patch) => profiles.updateWater(profiles.editing, patch)}
                    fixedPosition={fixedPosition}
                    onFixedPositionChange={onFixedPositionChange}
                    systemNotificationsEnabled={profiles.profiles[profiles.editing].systemNotificationsEnabled}
                    onSystemNotificationsChange={(enabled) => profiles.setNotifications(profiles.editing, enabled)}
                    todayCount={todayWaterCount}
                    history={waterHistory}
                    nextReminderAt={nextWaterReminderAt}
                    onResetCountdown={onResetWaterCountdown}
                    onClose={() => {
                      // A reminder can arrive while this panel is open. Keep
                      // it visible when the user closes settings so they do
                      // not need to summon the island again from the top edge.
                      setMode(queue[0]?.kind === "timer" ? "card" : "idle");
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
                      holdDurationSeconds={waterReminder.confirmHoldSeconds}
                      confirmMethod={waterReminder.confirmMethod}
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
            {!settingsOpen && !showTransition && mode === "card" && queue[0]?.kind === "generic" && (
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

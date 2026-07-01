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

import { setClickThrough, setPillRect } from "../lib/tauri";
import type { IslandMode } from "../lib/types";
import { useIslandStore } from "../store/islandStore";
import { IdlePill } from "./IdlePill";
import { NotificationList } from "./NotificationList";
import { NotificationView } from "./NotificationView";

const MORPH_SPRING = { type: "spring", stiffness: 380, damping: 30 } as const;
const SLIDE_SPRING = { type: "spring", stiffness: 300, damping: 28 } as const;

const WIN_W = 480;
const WIN_H = 260;

/** Pill geometry per mode. The morph animates between these. `hidden` is a thin
 *  full-width bar (the notch) that takes almost no vertical space. */
function pillGeometry(mode: IslandMode) {
  switch (mode) {
    case "hidden":
      // thin sliver: wide, ~8px tall, gently rounded — the "notch".
      return { width: 220, height: 8, radius: 6 };
    case "idle":
      return { width: 150, height: 38, radius: 999 };
    case "compact":
      return { width: 360, height: 60, radius: 30 };
    case "expanded":
      return { width: 432, height: 230, radius: 34 };
  }
}

/** The pill's top sits this far below the window's top edge. Always flush: the
 *  pill grows DOWNWARD from the top so the notch and the expanded view share the
 *  same top anchor (no vertical jump when morphing). */
const PILL_TOP = 0;

export function DynamicIsland() {
  const mode = useIslandStore((s) => s.mode);
  const setMode = useIslandStore((s) => s.setMode);
  const dismiss = useIslandStore((s) => s.dismiss);
  const clearAll = useIslandStore((s) => s.clearAll);
  const queue = useIslandStore((s) => s.queue);
  const overPill = useIslandStore((s) => s.overPill);
  const n = queue[0];

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const g = pillGeometry(mode);

  // Click-through strategy. The OS window is 480×260 but mostly transparent;
  // let clicks on the dead transparent area pass through, while keeping the
  // actual pill clickable.
  //   - compact/expanded: always interactive.
  //   - idle: interactive ONLY when the cursor is over the pill (`overPill`).
  //   - hidden (notch): always click-through.
  const interactive =
    mode === "compact" || mode === "expanded" || (mode === "idle" && overPill);
  useEffect(() => {
    void setClickThrough(!interactive);
  }, [interactive]);

  // Sync the pill's on-screen rect to the backend (for hit-testing while
  // click-through). The pill is centered, top at PILL_TOP.
  useEffect(() => {
    const x = (WIN_W - g.width) / 2;
    void setPillRect(x, PILL_TOP, g.width, g.height);
  }, [g.width, g.height]);

  // Click: compact/idle -> expanded (show the list); expanded -> compact.
  // No-op when there's nothing to expand into.
  function handleClick() {
    if (modeRef.current === "expanded") setMode("compact");
    else if (
      queue.length > 0 &&
      (modeRef.current === "compact" || modeRef.current === "idle")
    )
      setMode("expanded");
  }
  // Hovering the revealed pill expands it to the notification list — but ONLY
  // when there are notifications to show. With an empty queue, hovering keeps
  // the small idle pill (no awkward empty box).
  function handleEnter() {
    if (queue.length > 0 && (modeRef.current === "idle" || modeRef.current === "compact"))
      setMode("expanded");
  }
  function handleLeave() {
    // Leaving the pill collapses straight away — no intermediate "shrink to
    // small pill then hide" step.
    if (modeRef.current === "expanded") setMode("hidden");
    else if (modeRef.current === "compact") setMode("hidden");
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
          {/* The pill. Morphs width/height/borderRadius only. */}
          <motion.div
            onClick={handleClick}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            animate={{ width: g.width, height: g.height, borderRadius: g.radius }}
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
              {mode === "hidden" ? (
                // notch sliver: no content, just the dark bar
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
              ) : n ? (
                <motion.div
                  key="notif"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full w-full"
                >
                  <NotificationView n={n} expanded={false} onDismiss={() => dismiss(n.id)} />
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
                  <IdlePill />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

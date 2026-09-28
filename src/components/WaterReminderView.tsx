import { useEffect, useRef, useState, type PointerEvent } from "react";
import { motion, useIsPresent } from "motion/react";

import type { Notification } from "../lib/types";
import { playWaterConfirmedSound, startWaterHoldSound } from "../lib/sound";

interface Props {
  n: Notification;
  soundEnabled: boolean;
  holdDurationSeconds: number;
  confirmMethod: "hold" | "hover";
  onConfirmed: () => void;
}

export function WaterReminderView({ n, soundEnabled, holdDurationSeconds, confirmMethod, onConfirmed }: Props) {
  const isPresent = useIsPresent();
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const stopHoldSoundRef = useRef<(() => void) | null>(null);
  const holdDurationMs = holdDurationSeconds * 1000;

  function completeConfirmation() {
    if (completedRef.current) return;
    completedRef.current = true;
    stopFrame();
    stopHoldSound();
    setHolding(false);
    setProgress(1);
    onConfirmed();
    if (soundEnabled) playWaterConfirmedSound();
  }

  function confirmByHover() {
    if (confirmMethod !== "hover" || completedRef.current || !isPresent) return;
    if (startRef.current !== null) return;
    if (holdDurationMs <= 0) {
      completeConfirmation();
      return;
    }
    startRef.current = performance.now();
    setProgress(0);
    setHolding(true);
    if (soundEnabled) stopHoldSoundRef.current = startWaterHoldSound(holdDurationMs);
    frameRef.current = window.requestAnimationFrame(tick);
  }

  function stopHoldSound() {
    stopHoldSoundRef.current?.();
    stopHoldSoundRef.current = null;
  }

  function stopFrame() {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  function resetHold() {
    stopFrame();
    stopHoldSound();
    startRef.current = null;
    setHolding(false);
    if (!completedRef.current) setProgress(0);
  }

  function tick(now: number) {
    const startedAt = startRef.current;
    if (startedAt === null || completedRef.current) return;

    const nextProgress = Math.min(1, (now - startedAt) / holdDurationMs);
    setProgress(nextProgress);
    if (nextProgress >= 1) {
      completeConfirmation();
      return;
    }
    frameRef.current = window.requestAnimationFrame(tick);
  }

  function beginHold(event: PointerEvent<HTMLDivElement>) {
    if (confirmMethod !== "hold" || !isPresent || !event.isPrimary || startRef.current !== null || completedRef.current || event.button !== 0) return;
    event.preventDefault();
    if (holdDurationMs <= 0) {
      completeConfirmation();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    stopFrame();
    startRef.current = performance.now();
    setProgress(0);
    setHolding(true);
    if (soundEnabled) stopHoldSoundRef.current = startWaterHoldSound(holdDurationMs);
    frameRef.current = window.requestAnimationFrame(tick);
  }

  useEffect(() => {
    window.addEventListener("blur", resetHold);
    return () => {
      window.removeEventListener("blur", resetHold);
      stopFrame();
      stopHoldSound();
    };
  }, []);

  useEffect(() => {
    if (!isPresent) resetHold();
  }, [isPresent]);

  const waterTop = 68 - progress * 43;

  return (
    <div
      className="flex h-full w-full touch-none select-none items-center gap-3 px-4 py-3"
      onPointerDown={beginHold}
      onPointerEnter={confirmByHover}
      onPointerLeave={confirmMethod === "hover" ? resetHold : undefined}
      onPointerUp={resetHold}
      onPointerCancel={resetHold}
      onLostPointerCapture={resetHold}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
    >
      <motion.div
        animate={{
          rotate: holding ? [0, -7, 7, -4, 4, 0] : [0, -3, 3, -2, 2, 0],
          y: holding ? [0, -1, 1, 0] : 0,
        }}
        transition={{
          duration: holding ? 0.8 : 1.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative flex h-16 w-14 shrink-0 items-center justify-center"
      >
        <div className="relative h-14 w-12">
          <svg viewBox="0 0 56 68" className="h-full w-full" aria-hidden="true">
            <defs>
              <clipPath id={`water-cup-${n.id}`}>
                <path d="M11 12h34l-3.5 46H14.5L11 12Z" />
              </clipPath>
            </defs>
            <path
              d="M45 21h4.5a5.5 5.5 0 0 1 0 11H44"
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <g clipPath={`url(#water-cup-${n.id})`}>
              <motion.rect
                x="8"
                width="40"
                height="48"
                y={waterTop}
                rx="4"
                fill="url(#water-gradient)"
              />
              <motion.path
                d={`M8 ${waterTop} C16 ${waterTop - 3}, 22 ${waterTop + 3}, 28 ${waterTop} S40 ${waterTop - 3}, 48 ${waterTop}`}
                fill="none"
                stroke="rgba(207,250,254,0.9)"
                strokeWidth="1.5"
              />
            </g>
            <defs>
              <linearGradient id="water-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="#67e8f9" stopOpacity="0.95" />
                <stop offset="1" stopColor="#0891b2" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <path
              d="M11 12h34l-3.5 46H14.5L11 12Z"
              fill="rgba(255,255,255,0.04)"
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M9 12h38" stroke="#cffafe" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <motion.span
          aria-hidden="true"
          animate={{ opacity: holding ? [0.3, 0.9, 0.3] : [0.2, 0.6, 0.2], y: [2, -2, 2] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="pointer-events-none absolute -right-0.5 top-0 text-[12px] text-cyan-200"
        >
          💧
        </motion.span>
      </motion.div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-200/65">
          {n.appName}
        </div>
        <div className="text-[13px] font-semibold leading-snug text-white">{n.title}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-white/60">
          {confirmMethod === "hold"
            ? <>长按提醒窗口任意位置 {holdDurationSeconds} 秒，注满水杯确认已喝水</>
            : (holdDurationSeconds === 0
              ? "鼠标移入提醒窗口立即确认已喝水"
              : <>鼠标移入提醒窗口并保持 {holdDurationSeconds} 秒，确认已喝水</>)}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400"
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.08, ease: "linear" }}
          />
        </div>
        <div className="mt-1 text-[9px] text-white/35">
          {confirmMethod === "hover" ? (completedRef.current ? "已确认" : (holding ? `${Math.round(progress * 100)}% · 继续保持` : "移入窗口开始确认")) : (holding ? `${Math.round(progress * 100)}% · 继续按住` : "松开后进度会重新开始")}
        </div>
      </div>
    </div>
  );
}

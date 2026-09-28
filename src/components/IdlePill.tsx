// The idle pill: a small dark capsule with a "live" breathing dot and a clock.

import { useEffect, useState } from "react";
import { motion } from "motion/react";

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

interface Props {
  onOpenSettings?: () => void;
}

export function IdlePill({ onOpenSettings }: Props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center gap-2 px-3">
      {/* breathing "live" dot */}
      <motion.span
        className="block h-2 w-2 rounded-full bg-emerald-400"
        animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-[13px] font-medium tabular-nums text-white/90">
        {formatTime(now)}
      </span>
      {onOpenSettings && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenSettings();
          }}
          className="rounded-full p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="打开喝水提醒设置"
          title="喝水提醒设置"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path
              d="M6.7 1.7h2.6l.35 1.55c.35.13.69.33 1 .58l1.5-.55 1.3 2.25-1.15 1.1c.06.38.06.77 0 1.14l1.15 1.11-1.3 2.25-1.5-.56c-.31.26-.65.46-1 .59L9.3 12.7H6.7l-.35-1.54a4.9 4.9 0 0 1-1-.59l-1.5.56-1.3-2.25 1.15-1.11a4.34 4.34 0 0 1 0-1.14L2.55 5.53l1.3-2.25 1.5.55c.31-.25.65-.45 1-.58L6.7 1.7Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <circle cx="8" cy="7.2" r="1.8" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      )}
    </div>
  );
}

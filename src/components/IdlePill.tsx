// The idle pill: a small dark capsule with a "live" breathing dot and a clock.

import { useEffect, useState } from "react";
import { motion } from "motion/react";

function formatTime(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function IdlePill() {
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
    </div>
  );
}

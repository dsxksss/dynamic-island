import { motion, useReducedMotion } from "motion/react";
import type { ReminderProfile } from "../lib/profileMode";

export function ModeTransition({ mode }: { mode: ReminderProfile }) {
  const reduced = useReducedMotion();
  const game = mode === "game";
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex h-full items-center gap-3 px-5 text-white"
    >
      <motion.div
        initial={{ scale: reduced ? 1 : 0.5, rotate: reduced ? 0 : -18 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 20 }}
        className={game ? "text-violet-300" : "text-cyan-300"}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {game ? <><path d="M7 7h10c2 0 3 2 3.5 5l.7 5c.3 2-1.5 3-3 1.5L15 16H9l-3.2 2.5C4.3 20 2.5 19 2.8 17l.7-5C4 9 5 7 7 7Z" /><path d="M8 10v4m-2-2h4" /><circle cx="16" cy="11" r=".5" /><circle cx="18" cy="13" r=".5" /></> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}
        </svg>
      </motion.div>
      <div>
        <div className="text-[13px] font-semibold">{game ? "已进入游戏模式" : "已恢复普通模式"}</div>
        <div className="mt-1 text-[10px] text-white/45">{game ? "游戏配置已生效" : "普通配置已生效"}</div>
      </div>
    </motion.div>
  );
}

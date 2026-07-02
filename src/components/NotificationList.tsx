// A scrollable list of all queued notifications, shown when the pill is expanded.

import { AnimatePresence, motion } from "motion/react";

import type { Notification } from "../lib/types";

interface Props {
  items: Notification[];
  activeId?: string;
  filterText: string;
  onFilterChange: (t: string) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

function AppIcon({ name, icon }: { name: string; icon?: string }) {
  const initial = name.slice(0, 1);
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="h-8 w-8 shrink-0 rounded-lg object-cover"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-[13px] font-semibold text-white">
      {initial}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  if (sameDay) return `${h}:${m}`;
  const mo = (d.getMonth() + 1).toString().padStart(2, "0");
  const da = d.getDate().toString().padStart(2, "0");
  return `${mo}/${da} ${h}:${m}`;
}

export function NotificationList({
  items,
  filterText,
  onFilterChange,
  onDismiss,
  onClearAll,
}: Props) {
  // Filter by app name / title / body (case-insensitive).
  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (n) =>
          n.appName.toLowerCase().includes(q) ||
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q),
      )
    : items;

  return (
    <div className="flex h-full w-full flex-col px-3 py-3">
      {/* filter input */}
      <div className="mb-2 shrink-0 px-1">
        <input
          type="text"
          value={filterText}
          onChange={(e) => {
            e.stopPropagation();
            onFilterChange(e.target.value);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          placeholder="过滤通知（应用名/关键词）..."
          className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/80 outline-none transition-colors placeholder:text-white/30 focus:border-white/20 focus:bg-white/10"
        />
      </div>

      {/* scrollable list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {filtered.map((n) => (
            <motion.div
              key={n.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12, height: 0 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="group mb-1 flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-white/[0.06]"
            >
              <AppIcon name={n.appName} icon={n.icon} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium text-white/90">
                    {n.title || n.appName}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-white/35">
                    {formatTime(n.timestamp)}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/55">
                    {n.body}
                  </p>
                )}
                <div className="mt-0.5 text-[10px] text-white/35">{n.appName}</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(n.id);
                }}
                className="shrink-0 self-center rounded-full px-1.5 py-0.5 text-[10px] text-white/30 opacity-0 transition-opacity hover:bg-white/10 hover:text-white/70 group-hover:opacity-100"
              >
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* footer: clear all */}
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="shrink-0 border-t border-white/5 pt-2"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
            className="w-full rounded-lg py-1.5 text-center text-[11px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            全部清空
          </button>
        </motion.div>
      )}
    </div>
  );
}

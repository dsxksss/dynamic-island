// A scrollable list of all queued notifications. Clicking a single item opens
// it to show the full body (no truncation); the pill grows to fit.
//
// Visual style: iOS-like — circular avatars, clean title/subtitle layering,
// generous spacing, each item reads as a polished card.

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { Notification } from "../lib/types";

interface Props {
  items: Notification[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

function AppIcon({ name, icon }: { name: string; icon?: string }) {
  const initial = name.slice(0, 1);
  // Fallback avatar (shown when no icon OR icon fails to load).
  const fallback = (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-[14px] font-semibold text-white ring-1 ring-white/10">
      {initial}
    </div>
  );
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        draggable={false}
        // If the data URL is invalid/corrupt, swap to the fallback avatar.
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
        }}
      />
    );
  }
  return fallback;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  // relative: "刚刚" / "5分钟前" / "时:分"
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
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
  onDismiss,
  onClearAll,
}: Props) {
  // Which item is expanded (full body shown). Null = all collapsed.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col px-3 pb-2 pt-3">
      {/* scrollable list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {items.map((n) => {
            const open = expandedId === n.id;
            return (
              <motion.div
                key={n.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedId(open ? null : n.id);
                }}
                className={
                  "group mb-2 cursor-pointer rounded-2xl px-3 py-2.5 transition-colors " +
                  (open ? "bg-white/[0.08]" : "hover:bg-white/[0.05]")
                }
              >
                {/* header row: icon + title + time */}
                <div className="flex items-start gap-2.5">
                  <AppIcon name={n.appName} icon={n.icon} />
                  <div className="min-w-0 flex-1">
                    <div
                      className={
                        "text-[12.5px] font-semibold leading-snug text-white " +
                        (open ? "" : "truncate")
                      }
                    >
                      {n.title || n.appName}
                    </div>
                    <div className="truncate text-[10.5px] leading-tight text-white/40">
                      {n.appName} · {formatTime(n.timestamp)}
                    </div>
                  </div>
                  {/* dismiss (appears on hover) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(n.id);
                    }}
                    className="shrink-0 self-start rounded-full p-1 text-white/30 opacity-0 transition-opacity hover:bg-white/10 hover:text-white/70 group-hover:opacity-100"
                    aria-label="关闭"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 2L10 10M10 2L2 10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                {/* body: truncated when collapsed, full when open */}
                {n.body && (
                  <p
                    className={
                      "mt-1.5 pl-[46px] text-[11.5px] leading-relaxed text-white/65 transition-all " +
                      (open
                        ? "whitespace-pre-wrap break-words"
                        : "line-clamp-2")
                    }
                  >
                    {n.body}
                  </p>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* footer: clear all */}
      {items.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="shrink-0 pt-1.5"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearAll();
            }}
            className="w-full rounded-xl py-1.5 text-center text-[11px] font-medium text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            清空全部
          </button>
        </motion.div>
      )}
    </div>
  );
}

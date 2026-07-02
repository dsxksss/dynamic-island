// Notification content shown in compact and expanded modes.

import { motion } from "motion/react";

import type { Notification } from "../lib/types";

function AppIcon({ name, icon }: { name: string; icon?: string }) {
  const initial = name.slice(0, 1);
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="h-7 w-7 shrink-0 rounded-lg object-cover"
        draggable={false}
      />
    );
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15 text-[13px] font-semibold text-white">
      {initial}
    </div>
  );
}

interface Props {
  n: Notification;
  expanded: boolean;
  onDismiss: () => void;
}

export function NotificationView({ n, expanded, onDismiss }: Props) {
  return (
    <div className="flex h-full w-full items-center gap-3 px-4 py-2">
      <AppIcon name={n.appName} icon={n.icon} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[11px] font-medium uppercase tracking-wide text-white/50">
            {n.appName}
          </span>
        </div>
        <div
          className={
            "truncate text-[13px] font-medium text-white " +
            (expanded ? "" : "leading-tight")
          }
        >
          {n.title}
        </div>
        {expanded ? (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1 text-[12px] leading-snug text-white/70"
          >
            {n.body}
          </motion.p>
        ) : (
          <div className="truncate text-[12px] text-white/60">{n.body}</div>
        )}
      </div>

      {expanded && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/20"
        >
          关闭
        </motion.button>
      )}
    </div>
  );
}

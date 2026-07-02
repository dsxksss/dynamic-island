// A single notification shown as a medium card (expanded mode).

import type { Notification } from "../lib/types";

function AppIcon({ name, icon }: { name: string; icon?: string }) {
  const initial = name.slice(0, 1);
  const fallback = (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-[15px] font-semibold text-white ring-1 ring-white/10">
      {initial}
    </div>
  );
  if (icon) {
    return (
      <img
        src={icon}
        alt={name}
        className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-white/10"
        draggable={false}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return fallback;
}

interface Props {
  n: Notification;
  expanded: boolean;
  /** Auto-close countdown duration in ms (unused now, kept for compat). */
  autoCloseMs?: number;
  onDismiss: () => void;
}

export function NotificationView({ n, onDismiss }: Props) {
  return (
    <div className="flex h-full w-full items-start gap-3 px-4 py-3">
      <AppIcon name={n.appName} icon={n.icon} />

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-white/40">
          {n.appName}
        </div>
        <div className="text-[13px] font-semibold leading-snug text-white">
          {n.title || n.appName}
        </div>
        {n.body && (
          <p className="mt-1 line-clamp-3 break-words text-[11.5px] leading-relaxed text-white/60">
            {n.body}
          </p>
        )}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="shrink-0 rounded-full p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
        aria-label="关闭"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 3L11 11M11 3L3 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

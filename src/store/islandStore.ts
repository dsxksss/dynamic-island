// Global island state: the notification queue + display mode.

import { create } from "zustand";

import type { IslandMode, ListenerStatus, Notification } from "../lib/types";

interface IslandState {
  /** Newest first. The top of the queue is what the island shows. */
  queue: Notification[];
  mode: IslandMode;
  /** Whether the cursor is directly over the pill (from backend watcher). Used
   *  to selectively disable click-through so the pill is clickable in idle. */
  overPill: boolean;
  /** Backend listener status (null until the first event arrives). */
  status: ListenerStatus | null;
  /** Whether real capture is unavailable (drives demo-mode fallback). */
  demo: boolean;

  enqueue: (n: Notification) => void;
  remove: (id: string) => void;
  dismissTop: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  setMode: (m: IslandMode) => void;
  setOverPill: (v: boolean) => void;
  setStatus: (s: ListenerStatus) => void;
  setDemo: (d: boolean) => void;
}

const MAX_QUEUE = 20;

export const useIslandStore = create<IslandState>((set, get) => ({
  queue: [],
  mode: "idle",
  overPill: false,
  status: null,
  demo: false,

  enqueue: (n) =>
    set((s) => {
      // De-dup by id, keep newest first, cap the queue.
      const filtered = s.queue.filter((x) => x.id !== n.id);
      return { queue: [n, ...filtered].slice(0, MAX_QUEUE) };
    }),

  remove: (id) =>
    set((s) => ({ queue: s.queue.filter((x) => x.id !== id) })),

  dismissTop: () => {
    const { queue, remove } = get();
    const top = queue[0];
    if (top) remove(top.id);
  },
  dismiss: (id) =>
    set((s) => ({ queue: s.queue.filter((x) => x.id !== id) })),
  clearAll: () => set({ queue: [] }),

  setMode: (m) => set({ mode: m }),
  setOverPill: (v) => set({ overPill: v }),
  setStatus: (s) => set({ status: s, demo: s.available === false }),
  setDemo: (d) => set({ demo: d }),
}));

/** The notification currently surfaced by the island (top of the queue). */
export function useActiveNotification(): Notification | undefined {
  return useIslandStore((s) => s.queue[0]);
}

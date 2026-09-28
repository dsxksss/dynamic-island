// Thin Tauri IPC wrappers. All calls are safe no-ops (returning a sensible
// default) when not running inside Tauri — so the UI is testable in a plain
// browser via `vite dev` too.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { ListenerStatus, Notification, PlatformInfo } from "./types";

const RUNNING_IN_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Poll the backend for new system toast notifications. Returns only newly-seen
 *  ones (deduped by the backend). The frontend calls this every ~2.5s. */
export async function pollNotifications(): Promise<Notification[]> {
  if (!RUNNING_IN_TAURI) return [];
  return invoke<Notification[]>("poll_notifications");
}

/** Subscribe to the `listener-status` event (legacy; status is also pullable). */
export function onListenerStatus(
  cb: (s: ListenerStatus) => void,
): Promise<UnlistenFn> {
  if (!RUNNING_IN_TAURI) return Promise.resolve(() => {});
  return listen<ListenerStatus>("island://listener-status", (e) => cb(e.payload));
}

/** Subscribe to the global top-edge hover + over-pill event (Rust watcher). */
export function onTopHover(
  cb: (p: { hovering: boolean; overPill: boolean }) => void,
): Promise<UnlistenFn> {
  if (!RUNNING_IN_TAURI) return Promise.resolve(() => {});
  return listen<{ hovering: boolean; overPill: boolean }>("island://top-hover", (e) =>
    cb(e.payload),
  );
}

/** Tell the backend where the pill is on screen (logical px, window-relative)
 *  so the cursor watcher can hit-test it while click-through. */
export async function setPillRect(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  if (!RUNNING_IN_TAURI) return;
  await invoke("set_pill_rect_cmd", { x, y, width, height });
}

/** Pull the current listener status synchronously. */
export async function getListenerStatus(): Promise<ListenerStatus | null> {
  if (!RUNNING_IN_TAURI) return null;
  return invoke<ListenerStatus>("get_listener_status");
}

/** Platform / identity info for the settings view. */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (!RUNNING_IN_TAURI) return { platform: "web", hasPackageIdentity: false };
  return invoke<PlatformInfo>("platform_info");
}

/** Acknowledge a captured notification. */
export async function dismissNotification(id: string): Promise<void> {
  if (!RUNNING_IN_TAURI) return;
  await invoke("dismiss_notification", { id });
}

/** Toggle whole-window click-through. */
let cursorUpdates: Promise<void> = Promise.resolve();
export function setClickThrough(ignore: boolean): Promise<void> {
  if (!RUNNING_IN_TAURI) return Promise.resolve();
  // Serialize IPC so a late completion cannot restore stale interaction state.
  cursorUpdates = cursorUpdates.catch(() => {}).then(() =>
    getCurrentWindow().setIgnoreCursorEvents(ignore),
  );
  return cursorUpdates;
}

/** Subscribe to the water-reminder toggle from the system tray. */
export function onWaterReminderTrayToggle(
  cb: () => void,
): Promise<UnlistenFn> {
  if (!RUNNING_IN_TAURI) return Promise.resolve(() => {});
  return listen("island://water-reminder-toggle", () => cb());
}

/** Update the current enabled state shown in the system tray menu. */
export async function setWaterReminderTrayState(enabled: boolean): Promise<void> {
  if (!RUNNING_IN_TAURI) return;
  await invoke("set_water_tray_state", { enabled });
}

/** Allow keyboard focus while the settings panel is open. */
let focusUpdates: Promise<void> = Promise.resolve();
export function setWindowFocusable(focusable: boolean): Promise<void> {
  if (!RUNNING_IN_TAURI) return Promise.resolve();
  focusUpdates = focusUpdates.catch(() => {}).then(async () => {
    const window = getCurrentWindow();
    await window.setFocusable(focusable);
    if (focusable) await window.setFocus();
  });
  return focusUpdates;
}

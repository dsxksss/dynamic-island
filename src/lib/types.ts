// Types shared with the Rust backend (mirrors src-tauri/src/notifications.rs).

export type NotificationKind = "generic" | "music" | "timer";

export interface Notification {
  id: string;
  appName: string;
  /** App icon as a data URL (base64 PNG), empty if unavailable. */
  icon: string;
  title: string;
  body: string;
  timestamp: number;
  kind: NotificationKind;
}

export interface ListenerStatus {
  available: boolean;
  reason: string | null;
  message: string;
}

export interface PlatformInfo {
  platform: string;
  hasPackageIdentity: boolean;
}

/** The island's high-level display mode.
 *  `hidden` = auto-hidden off the top of the screen, summoned by hovering the
 *  screen's top edge. The OS window is fixed-size; only the pill morphs.
 *  `card` = medium single-notification card (when a new notification arrives).
 *  `expanded` = large list card showing all notifications (click card to open). */
export type IslandMode = "hidden" | "idle" | "compact" | "card" | "expanded";

export type ReminderProfile = "normal" | "game";

export function resolveProfile(autoFullscreen: boolean, fullscreen: boolean, manual: ReminderProfile): ReminderProfile {
  return autoFullscreen ? (fullscreen ? "game" : "normal") : manual;
}

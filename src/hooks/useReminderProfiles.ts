import { useEffect, useRef, useState } from "react";
import type { WaterReminderSettings } from "../lib/types";
import { normalizeSettings, readSettings } from "../lib/waterSettings";
import { resolveProfile, type ReminderProfile } from "../lib/profileMode";
import { getFullscreenState, onFullscreenChange } from "../lib/tauri";

const STORAGE_KEY = "dynamic-island.profiles.v1";
interface ProfileSettings {
  water: WaterReminderSettings;
  systemNotificationsEnabled: boolean;
}
interface SavedProfiles {
  profiles: Record<ReminderProfile, ProfileSettings>;
  manual: ReminderProfile;
  autoFullscreen: boolean;
}

export function readProfiles(): SavedProfiles {
  const water = readSettings();
  let notifications = false;
  try { notifications = localStorage.getItem("dynamic-island.system-notifications.v2") === "true"; } catch { /* Use defaults. */ }
  const fallback: SavedProfiles = {
    profiles: {
      normal: { water: { ...water }, systemNotificationsEnabled: notifications },
      game: { water: { ...water }, systemNotificationsEnabled: notifications },
    },
    manual: "normal",
    autoFullscreen: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    for (const mode of ["normal", "game"] as const) {
      const profile = saved?.profiles?.[mode];
      if (profile && typeof profile === "object") {
        fallback.profiles[mode] = {
          water: normalizeSettings({ ...water, ...profile.water }),
          systemNotificationsEnabled: typeof profile.systemNotificationsEnabled === "boolean"
            ? profile.systemNotificationsEnabled : notifications,
        };
      }
    }
    fallback.manual = saved?.manual === "game" ? "game" : "normal";
    fallback.autoFullscreen = saved?.autoFullscreen === true;
  } catch { /* Keep old settings if the saved profiles are malformed. */ }
  return fallback;
}

export function useReminderProfiles() {
  const [saved, setSaved] = useState(readProfiles);
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState<ReminderProfile>(saved.manual);
  const active = resolveProfile(saved.autoFullscreen, fullscreen, saved.manual);
  const [transition, setTransition] = useState<ReminderProfile | null>(null);
  const previous = useRef(active);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Session still works. */ }
  }, [saved]);

  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    void onFullscreenChange((value) => {
      receivedEvent = true;
      if (!disposed) setFullscreen(value);
    }).then(async (cleanup) => {
      if (disposed) { cleanup(); return; }
      unlisten = cleanup;
      const initial = await getFullscreenState();
      if (!disposed && !receivedEvent) setFullscreen(initial);
    }).catch(console.error);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    setTransition(active);
  }, [active]);

  useEffect(() => {
    if (!transition) return;
    const timer = window.setTimeout(() => setTransition(null), 2400);
    return () => window.clearTimeout(timer);
  }, [transition]);

  function updateWater(profile: ReminderProfile, patch: Partial<WaterReminderSettings>) {
    setSaved((current) => ({ ...current, profiles: { ...current.profiles,
      [profile]: { ...current.profiles[profile], water: normalizeSettings({ ...current.profiles[profile].water, ...patch }) },
    } }));
  }
  function setNotifications(profile: ReminderProfile, enabled: boolean) {
    setSaved((current) => ({ ...current, profiles: { ...current.profiles,
      [profile]: { ...current.profiles[profile], systemNotificationsEnabled: enabled },
    } }));
  }
  function selectMode(profile: ReminderProfile) {
    setSaved((current) => ({ ...current, manual: profile, autoFullscreen: false }));
  }
  function setAutoFullscreen(enabled: boolean) {
    setSaved((current) => ({ ...current, manual: active, autoFullscreen: enabled }));
  }

  return { ...saved, active, editing, setEditing, updateWater, setNotifications, selectMode, setAutoFullscreen, transition };
}

export type ReminderProfilesController = ReturnType<typeof useReminderProfiles>;

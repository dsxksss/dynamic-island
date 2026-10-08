import { DynamicIsland } from "./components/DynamicIsland";
import { useNotifications } from "./hooks/useNotifications";
import { useReminderProfiles } from "./hooks/useReminderProfiles";
import { useWaterReminder } from "./hooks/useWaterReminder";
import { playWaterReminderChime } from "./lib/sound";
import {
  onWaterReminderTrayToggle,
  readSavedIslandPosition,
  recenterIsland,
  restoreIslandPosition,
  setWaterReminderTrayState,
} from "./lib/tauri";
import { useEffect, useRef, useState } from "react";

const FIXED_POSITION_STORAGE_KEY = "dynamic-island.fixed-position.v1";
function readFixedPosition(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(FIXED_POSITION_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export default function App() {
  // Wire backend events + drive the auto-collapsing state machine / demo feed.
  const profiles = useReminderProfiles();
  const currentProfile = profiles.profiles[profiles.active];
  const systemNotificationsEnabled = currentProfile.systemNotificationsEnabled;
  useNotifications(systemNotificationsEnabled);
  const waterReminder = useWaterReminder(currentProfile.water, profiles.active);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fixedPosition, setFixedPosition] = useState(readFixedPosition);
  const waterReminderRef = useRef({ waterReminder, profiles });
  waterReminderRef.current = { waterReminder, profiles };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onWaterReminderTrayToggle(() => {
      const current = waterReminderRef.current;
      current.profiles.updateWater(current.profiles.active, { enabled: !current.waterReminder.settings.enabled });
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    void setWaterReminderTrayState(waterReminder.settings.enabled).catch(console.error);
  }, [waterReminder.settings.enabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FIXED_POSITION_STORAGE_KEY, String(fixedPosition));
    } catch {
      // Position mode still applies for the current session when storage is unavailable.
    }
    if (fixedPosition) {
      void recenterIsland().catch(console.error);
    } else {
      const saved = readSavedIslandPosition();
      if (saved) void restoreIslandPosition(saved).catch(console.error);
    }
  }, [fixedPosition]);

  return (
    <div className="flex min-h-screen w-full select-none items-start justify-center">
      <DynamicIsland
        waterReminder={waterReminder.settings}
        profiles={profiles}
        fixedPosition={fixedPosition}
        onFixedPositionChange={setFixedPosition}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        onTestWaterSound={playWaterReminderChime}
        onWaterReminderConfirmed={waterReminder.confirmWaterReminder}
        todayWaterCount={waterReminder.todayCount}
        waterHistory={waterReminder.history}
        nextWaterReminderAt={waterReminder.nextReminderAt}
        onResetWaterCountdown={waterReminder.resetCountdown}
      />
    </div>
  );
}

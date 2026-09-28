import { DynamicIsland } from "./components/DynamicIsland";
import { useNotifications } from "./hooks/useNotifications";
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
const SYSTEM_NOTIFICATIONS_STORAGE_KEY = "dynamic-island.system-notifications.v2";

function readSystemNotificationsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

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
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(readSystemNotificationsEnabled);
  useNotifications(systemNotificationsEnabled);
  const waterReminder = useWaterReminder();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fixedPosition, setFixedPosition] = useState(readFixedPosition);
  const waterReminderRef = useRef(waterReminder);
  waterReminderRef.current = waterReminder;

  useEffect(() => {
    try {
      window.localStorage.setItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY, String(systemNotificationsEnabled));
    } catch {
      // The switch still applies for this session if storage is unavailable.
    }
  }, [systemNotificationsEnabled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onWaterReminderTrayToggle(() => {
      const current = waterReminderRef.current;
      current.updateSettings({ enabled: !current.settings.enabled });
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
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
      if (saved) void restoreIslandPosition(saved.x, saved.y).catch(console.error);
    }
  }, [fixedPosition]);

  return (
    <div className="flex min-h-screen w-full select-none items-start justify-center">
      <DynamicIsland
        waterReminder={waterReminder.settings}
        onWaterReminderChange={waterReminder.updateSettings}
        fixedPosition={fixedPosition}
        onFixedPositionChange={setFixedPosition}
        systemNotificationsEnabled={systemNotificationsEnabled}
        onSystemNotificationsChange={setSystemNotificationsEnabled}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        onTestWaterSound={playWaterReminderChime}
        onWaterReminderConfirmed={waterReminder.confirmWaterReminder}
        todayWaterCount={waterReminder.todayCount}
        nextWaterReminderAt={waterReminder.nextReminderAt}
        onResetWaterCountdown={waterReminder.resetCountdown}
      />
    </div>
  );
}

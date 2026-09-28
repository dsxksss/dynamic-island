import { DynamicIsland } from "./components/DynamicIsland";
import { useNotifications } from "./hooks/useNotifications";
import { useWaterReminder } from "./hooks/useWaterReminder";
import { playWaterReminderChime } from "./lib/sound";
import { onWaterReminderTrayToggle, setWaterReminderTrayState } from "./lib/tauri";
import { useEffect, useRef, useState } from "react";

export default function App() {
  // Wire backend events + drive the auto-collapsing state machine / demo feed.
  useNotifications();
  const waterReminder = useWaterReminder();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const waterReminderRef = useRef(waterReminder);
  waterReminderRef.current = waterReminder;

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

  return (
    <div className="flex min-h-screen w-full select-none items-start justify-center">
      <DynamicIsland
        waterReminder={waterReminder.settings}
        onWaterReminderChange={waterReminder.updateSettings}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        onTestWaterSound={playWaterReminderChime}
        onWaterReminderConfirmed={waterReminder.confirmWaterReminder}
        todayWaterCount={waterReminder.todayCount}
        nextWaterReminderAt={waterReminder.nextReminderAt}
      />
    </div>
  );
}

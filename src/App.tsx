import { DynamicIsland } from "./components/DynamicIsland";
import { useNotifications } from "./hooks/useNotifications";

export default function App() {
  // Wire backend events + drive the auto-collapsing state machine / demo feed.
  useNotifications();

  return (
    <div className="flex min-h-screen w-full select-none items-start justify-center">
      <DynamicIsland />
    </div>
  );
}

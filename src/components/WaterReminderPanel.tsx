import { useEffect, useMemo, useState } from "react";

import { TimePicker } from "./TimePicker";

import type { WaterReminderSettings } from "../lib/types";

interface Props {
  settings: WaterReminderSettings;
  onChange: (patch: Partial<WaterReminderSettings>) => void;
  fixedPosition: boolean;
  onFixedPositionChange: (fixed: boolean) => void;
  systemNotificationsEnabled: boolean;
  onSystemNotificationsChange: (enabled: boolean) => void;
  onClose: () => void;
  onTestSound: () => void;
  todayCount: number;
  nextReminderAt: number | null;
  onResetCountdown: () => void;
}

export function WaterReminderPanel({
  settings,
  onChange,
  fixedPosition,
  onFixedPositionChange,
  systemNotificationsEnabled,
  onSystemNotificationsChange,
  onClose,
  onTestSound,
  todayCount,
  nextReminderAt,
  onResetCountdown,
}: Props) {
  const [intervalInput, setIntervalInput] = useState(() => String(settings.intervalMinutes));
  const [timeTarget, setTimeTarget] = useState<"startTime" | "endTime" | null>(null);
  const [durationInput, setDurationInput] = useState(String(settings.durationSeconds));
  const [holdInput, setHoldInput] = useState(String(settings.confirmHoldSeconds));
  useEffect(() => setDurationInput(String(settings.durationSeconds)), [settings.durationSeconds]);
  useEffect(() => setHoldInput(String(settings.confirmHoldSeconds)), [settings.confirmHoldSeconds]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setIntervalInput(String(settings.intervalMinutes));
  }, [settings.intervalMinutes]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const nextReminderText = useMemo(() => {
    if (!settings.enabled || nextReminderAt === null) return "提醒已暂停";
    return `下次提醒 ${new Date(nextReminderAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }, [nextReminderAt, settings.enabled]);
  const intervalMs = settings.intervalMinutes * 60_000;
  // The reminder bar represents the water that is still "in the tank": it
  // starts full after a reminder and drains toward empty as the next reminder
  // approaches.
  const remainingWater = settings.enabled && nextReminderAt !== null
    ? Math.min(1, Math.max(0, (nextReminderAt - now) / intervalMs))
    : 0;
  const waterStatus = !settings.enabled
    ? { label: "提醒已暂停", className: "text-white/35", barClassName: "bg-white/20" }
    : nextReminderAt === null
      ? { label: "等待补水计划", className: "text-white/45", barClassName: "bg-white/20" }
      : remainingWater > 0.66
        ? { label: "水分充足", className: "text-cyan-300/80", barClassName: "bg-gradient-to-r from-cyan-300 to-sky-400" }
        : remainingWater > 0.33
          ? { label: "注意补水", className: "text-amber-300/85", barClassName: "bg-gradient-to-r from-amber-300 to-yellow-400" }
          : remainingWater > 0.08
            ? { label: "水分偏低", className: "text-orange-300/90", barClassName: "bg-gradient-to-r from-orange-300 to-amber-500" }
            : { label: "缺水状态", className: "text-rose-300/95", barClassName: "bg-gradient-to-r from-rose-400 to-red-500" };

  function commitInterval() {
    const parsed = Number(intervalInput);
    const interval = Number.isFinite(parsed)
      ? Math.min(240, Math.max(1, Math.round(parsed)))
      : settings.intervalMinutes;
    setIntervalInput(String(interval));
    onChange({ intervalMinutes: interval });
  }

  function adjustInterval(delta: number) {
    onChange({
      intervalMinutes: Math.min(240, Math.max(1, settings.intervalMinutes + delta)),
    });
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden px-5 py-4 text-white">
      <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold tracking-tight">喝水提醒</div>
          <div className="mt-1 text-[11px] text-white/45">
            在指定时间段内按间隔提醒你补充水分
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full p-1.5 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭喝水提醒设置"
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

      <div className="water-settings-scroll min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-2">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">监听系统消息</div>
            <div className="mt-0.5 text-[10px] text-white/40">
              {systemNotificationsEnabled ? "在灵动岛显示系统通知" : "系统消息监听已关闭，喝水提醒不受影响"}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="监听系统消息"
            aria-checked={systemNotificationsEnabled}
            onClick={() => onSystemNotificationsChange(!systemNotificationsEnabled)}
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 ${
              systemNotificationsEnabled ? "bg-cyan-400" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                systemNotificationsEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">固定灵动岛位置</div>
            <div className="mt-0.5 text-[10px] text-white/40">
              {fixedPosition ? "固定在当前屏幕顶部中央" : "自由拖动放置，非常靠近边缘时才吸附"}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={fixedPosition}
            onClick={() => onFixedPositionChange(!fixedPosition)}
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 ${
              fixedPosition ? "bg-cyan-400" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                fixedPosition ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">启用喝水提醒</div>
            <div className="mt-0.5 text-[10px] text-white/40">
              {settings.enabled ? "提醒已开启" : "提醒已暂停"}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => onChange({ enabled: !settings.enabled })}
            className={`relative h-6 w-11 overflow-hidden rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 ${
              settings.enabled ? "bg-cyan-400" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                settings.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div className="mb-2 text-[12px] font-medium">提醒时间段</div>
          <div className="flex items-center gap-2">
            {(["startTime", "endTime"] as const).map((field) => (
              <button key={field} type="button" aria-haspopup="dialog"
                onClick={() => setTimeTarget(field)}
                className="min-w-0 flex-1 rounded-xl bg-black/20 px-3 py-2 text-left outline-none transition-colors hover:bg-cyan-400/10 focus-visible:ring-2 focus-visible:ring-cyan-200/50">
                <span className="block text-[10px] text-white/45">{field === "startTime" ? "开始时间" : "结束时间"}</span>
                <span className="mt-1 flex items-center justify-between text-[14px] font-semibold tabular-nums">
                  {settings[field]}
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-cyan-200/65" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" />
                    <path d="M8 4v4l2 1" stroke="currentColor" strokeLinecap="round" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-white/35">
            结束时间早于开始时间时，会自动按跨午夜时段计算
          </div>
        </div>

        <div className="rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-medium">提醒间隔</div>
              <div className="mt-0.5 text-[10px] text-white/40">每次提醒之间的时间</div>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-black/20 px-1.5 py-1">
              <button
                type="button"
                onClick={() => adjustInterval(-1)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[15px] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="减少提醒间隔"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={240}
                step={1}
                value={intervalInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setIntervalInput(value);
                  if (value !== "") {
                    onChange({ intervalMinutes: Number(value) });
                  }
                }}
                onBlur={commitInterval}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                className="w-10 appearance-none bg-transparent text-center text-[13px] font-semibold tabular-nums text-white outline-none focus:ring-0"
              />
              <button
                type="button"
                onClick={() => adjustInterval(1)}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[15px] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="增加提醒间隔"
              >
                +
              </button>
              <span className="pr-1 text-[10px] text-white/45">分钟</span>
            </div>
          </div>
        </div>


        <div className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">提醒持续时间</div>
            <div className="mt-0.5 text-[10px] text-white/40">5–300 秒 · 到时关闭窗口和音效</div>
            <div className="mt-0.5 text-[10px] text-white/30">修改后从下一次提醒生效</div>
          </div>
          <label className="flex shrink-0 items-center gap-2 rounded-xl bg-black/20 px-3 py-2">
            <input type="number" min={5} max={300} step={1} aria-label="提醒持续时间（秒）"
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(durationInput);
                const seconds = durationInput.trim() && Number.isFinite(parsed)
                  ? Math.min(300, Math.max(5, Math.round(parsed))) : settings.durationSeconds;
                setDurationInput(String(seconds));
                onChange({ durationSeconds: seconds });
              }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="w-10 bg-transparent text-center text-[13px] font-semibold tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-cyan-200/50" />
            <span className="text-[10px] text-white/45">秒</span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">确认持续时长</div>
            <div className="mt-0.5 text-[10px] text-white/40">0–10 秒 · 长按或移入后持续确认</div>
          </div>
          <label className="flex shrink-0 items-center gap-2 rounded-xl bg-black/20 px-3 py-2">
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              aria-label="确认持续时长（秒）"
              value={holdInput}
              onChange={(event) => setHoldInput(event.target.value)}
              onBlur={() => {
                const parsed = Number(holdInput);
                const seconds = holdInput.trim() && Number.isFinite(parsed)
                  ? Math.min(10, Math.max(0, Math.round(parsed)))
                  : settings.confirmHoldSeconds;
                setHoldInput(String(seconds));
                onChange({ confirmHoldSeconds: seconds });
              }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              className="w-10 bg-transparent text-center text-[13px] font-semibold tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-cyan-200/50"
            />
            <span className="text-[10px] text-white/45">秒</span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">确认方式</div>
            <div className="mt-0.5 text-[10px] text-white/40">
              {settings.confirmMethod === "hold"
                ? <>长按提醒窗口 {settings.confirmHoldSeconds} 秒确认</>
                : (settings.confirmHoldSeconds === 0
                  ? "鼠标移入提醒窗口立即确认"
                  : <>鼠标移入并保持 {settings.confirmHoldSeconds} 秒确认</>)}
            </div>
          </div>
          <div className="flex shrink-0 rounded-xl bg-black/20 p-1 text-[10px]">
            <button
              type="button"
              onClick={() => onChange({ confirmMethod: "hold" })}
              className={settings.confirmMethod === "hold" ? "rounded-lg bg-cyan-400 px-2.5 py-1.5 text-slate-950 transition-colors" : "rounded-lg px-2.5 py-1.5 text-white/55 transition-colors hover:text-white"}
            >
              长按
            </button>
            <button
              type="button"
              onClick={() => onChange({ confirmMethod: "hover" })}
              className={settings.confirmMethod === "hover" ? "rounded-lg bg-cyan-400 px-2.5 py-1.5 text-slate-950 transition-colors" : "rounded-lg px-2.5 py-1.5 text-white/55 transition-colors hover:text-white"}
            >
              移入
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">提醒音效</div>
            <div className="mt-0.5 text-[10px] text-white/40">循环提示，确认或 {settings.durationSeconds} 秒超时后停止</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTestSound}
              className="rounded-lg px-2 py-1 text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
            >
              试听
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={settings.soundEnabled}
              onClick={() => onChange({ soundEnabled: !settings.soundEnabled })}
              className={`relative h-6 w-11 overflow-hidden rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 ${
                settings.soundEnabled ? "bg-cyan-400" : "bg-white/15"
              }`}
            >
              <span
                className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  settings.soundEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

      </div>

      <div className="mt-3 shrink-0 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between text-[10px] text-white/55">
          <span>今日已喝水 {todayCount} 次</span>
          <div className="flex items-center gap-2">
            <span className={settings.enabled ? "text-cyan-200/75" : "text-white/35"}>
              {nextReminderText}
            </span>
            <button
              type="button"
              onClick={onResetCountdown}
              disabled={!settings.enabled}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              重置倒计时
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label="距离下次喝水提醒的剩余水分">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ${waterStatus.barClassName}`}
            style={{ width: `${remainingWater * 100}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-end text-[10px] text-white/30">
          <span className={waterStatus.className}>💧 {waterStatus.label}</span>
        </div>
      </div>
      {timeTarget && (
        <TimePicker
          label={timeTarget === "startTime" ? "开始时间" : "结束时间"}
          value={settings[timeTarget]}
          onCancel={() => setTimeTarget(null)}
          onConfirm={(value) => {
            onChange({ [timeTarget]: value });
            setTimeTarget(null);
          }}
        />
      )}
    </div>
  );
}

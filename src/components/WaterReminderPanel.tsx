import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import type { WaterReminderSettings } from "../lib/types";

interface Props {
  settings: WaterReminderSettings;
  onChange: (patch: Partial<WaterReminderSettings>) => void;
  onClose: () => void;
  onTestSound: () => void;
  todayCount: number;
  nextReminderAt: number | null;
}

interface TimeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function TimeField({ label, value, onChange }: TimeFieldProps) {
  const [hour, minute] = value.split(":");
  const [hourInput, setHourInput] = useState(hour);
  const [minuteInput, setMinuteInput] = useState(minute);

  useEffect(() => {
    setHourInput(hour);
    setMinuteInput(minute);
  }, [hour, minute]);

  function commit() {
    const nextHour = Math.min(23, Math.max(0, Number.parseInt(hourInput, 10) || 0));
    const nextMinute = Math.min(59, Math.max(0, Number.parseInt(minuteInput, 10) || 0));
    const nextValue = `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
    setHourInput(nextValue.slice(0, 2));
    setMinuteInput(nextValue.slice(3));
    onChange(nextValue);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setHourInput(hour);
      setMinuteInput(minute);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="min-w-0 flex-1 rounded-xl bg-black/20 px-3 py-2">
      <div className="text-[10px] text-white/45">{label}</div>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={hourInput}
          aria-label={`${label}小时`}
          onChange={(event) => setHourInput(event.target.value.replace(/\D/g, "").slice(0, 2))}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          onFocus={(event) => event.currentTarget.select()}
          className="w-7 bg-transparent text-[13px] font-semibold tabular-nums text-white outline-none"
        />
        <span className="text-[13px] font-semibold text-white/45">:</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={2}
          value={minuteInput}
          aria-label={`${label}分钟`}
          onChange={(event) => setMinuteInput(event.target.value.replace(/\D/g, "").slice(0, 2))}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          onFocus={(event) => event.currentTarget.select()}
          className="w-7 bg-transparent text-[13px] font-semibold tabular-nums text-white outline-none"
        />
        <svg className="ml-auto h-4 w-4 text-white/55" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.7" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 4.7V8l2.2 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

export function WaterReminderPanel({
  settings,
  onChange,
  onClose,
  onTestSound,
  todayCount,
  nextReminderAt,
}: Props) {
  const [intervalInput, setIntervalInput] = useState(() => String(settings.intervalMinutes));
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
  const progress = settings.enabled && nextReminderAt !== null
    ? Math.min(1, Math.max(0, 1 - (nextReminderAt - now) / intervalMs))
    : 0;

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
    <div className="flex h-full w-full flex-col overflow-hidden px-5 py-4 text-white">
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
            <TimeField
              label="开始时间"
              value={settings.startTime}
              onChange={(startTime) => onChange({ startTime })}
            />
            <span className="mt-4 text-white/30">→</span>
            <TimeField
              label="结束时间"
              value={settings.endTime}
              onChange={(endTime) => onChange({ endTime })}
            />
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

        <div className="flex items-center justify-between rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">提醒音效</div>
            <div className="mt-0.5 text-[10px] text-white/40">循环提示，确认或 30 秒超时后停止</div>
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

        <div className="flex items-center justify-between rounded-2xl bg-white/[0.07] px-3.5 py-3.5">
          <div>
            <div className="text-[12px] font-medium">全屏游戏免打扰</div>
            <div className="mt-0.5 text-[10px] text-white/40">开启后只播放提醒音效，不弹出水杯窗口</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.fullscreenDnd}
            onClick={() => onChange({ fullscreenDnd: !settings.fullscreenDnd })}
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 ${
              settings.fullscreenDnd ? "bg-cyan-400" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                settings.fullscreenDnd ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <div className="mt-3 shrink-0 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between text-[10px] text-white/55">
          <span>今日已喝水 {todayCount} 次</span>
          <span className={settings.enabled ? "text-cyan-200/75" : "text-white/35"}>
            {nextReminderText}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label="距离下次喝水提醒的进度">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-[width] duration-700"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-white/30">
          <span>支持 1–240 分钟 · 每次提醒保留 30 秒</span>
          <span className="text-cyan-300/70">💧 保持水分</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  label: string;
  value: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function TimePicker({ label, value, onConfirm, onCancel }: Props) {
  const [hour, setHour] = useState(Number(value.split(":")[0]));
  const [minute, setMinute] = useState(Number(value.split(":")[1]));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    root.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach(
      (item) => item.scrollIntoView({ block: "center" }),
    );
    root.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    return () => previousFocus?.focus({ preventScroll: true });
  }, []);

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === "Tab") {
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={`选择${label}`}
      onKeyDown={handleKeys}
      className="absolute inset-0 z-20 flex flex-col bg-[#101114] p-5 text-white">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-[14px] font-semibold">{label}</div>
        <div className="text-[20px] font-semibold tabular-nums text-cyan-200">{pad(hour)}:{pad(minute)}</div>
      </div>
      <div className="my-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
        {[
          { label: "小时", count: 24, selected: hour, select: setHour },
          { label: "分钟", count: 60, selected: minute, select: setMinute },
        ].map((column) => (
          <div key={column.label} className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white/[0.04] p-2">
            <div className="mb-1 text-center text-[10px] text-white/40">{column.label}</div>
            <div className="water-settings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" aria-label={column.label}>
              {Array.from({ length: column.count }, (_, index) => (
                <button key={index} type="button" aria-label={`${pad(index)} ${column.label}`}
                  aria-pressed={column.selected === index}
                  onClick={() => column.select(index)}
                  onKeyDown={(event) => {
                    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
                    if (!delta) return;
                    event.preventDefault();
                    const next = (index + delta + column.count) % column.count;
                    column.select(next);
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
                  }}
                  className={`mb-1 block h-8 w-full rounded-lg text-[14px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200/70 ${column.selected === index ? "bg-cyan-400/15 text-cyan-200" : "text-white/60 hover:bg-white/10"}`}>
                  {pad(index)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 gap-3">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl bg-white/10 py-2 text-[12px] hover:bg-white/15">取消</button>
        <button type="button" onClick={() => onConfirm(`${pad(hour)}:${pad(minute)}`)}
          className="flex-1 rounded-xl bg-cyan-300 py-2 text-[12px] font-semibold text-slate-950 hover:bg-cyan-200">确定</button>
      </div>
    </div>
  );
}

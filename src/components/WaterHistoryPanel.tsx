import { useMemo, useState, type KeyboardEvent } from "react";
import { localDateKey, waterDays, type WaterHistory } from "../lib/waterHistory";

const BLUE = ["#172331", "#173f73", "#1d64b5", "#3296ec", "#83caff"];
const level = (count: number) => count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 9 ? 3 : 4;
const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

export function WaterHistoryPanel({ history, now, onBack, onClose }: {
  history: WaterHistory; now: number; onBack: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"heatmap" | "trend">("heatmap");
  const [hovered, setHovered] = useState<number | null>(null);
  const today = localDateKey(new Date(now));
  const days = useMemo(() => waterDays(history, new Date(`${today}T12:00:00`)), [history, today]);
  const selected = days[hovered ?? days.length - 1];
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter(day => day.count > 0).length;
  const knownDays = days.filter(day => day.known).length;
  const offset = days[0].weekday;
  const weeks = Math.ceil((offset + days.length) / 7);
  const description = (index: number) => `${days[index].date} · ${days[index].known ? `喝水 ${days[index].count} 次` : "未记录"}`;
  const max = Math.max(4, ...days.map(day => day.count));
  const x = (i: number) => 28 + i / (days.length - 1) * 318;
  const y = (count: number) => 122 - count / max * 102;
  const segments: string[] = [];
  let segment = "";
  days.forEach((day, i) => {
    if (!day.known) { if (segment) segments.push(segment); segment = ""; }
    else segment += `${segment ? " L" : "M"}${x(i)},${y(day.count)}`;
  });
  if (segment) segments.push(segment);

  function changeTab(value: typeof tab) { setTab(value); setHovered(null); }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "heatmap" : event.key === "End" ? "trend" : tab === "heatmap" ? "trend" : "heatmap";
    changeTab(next);
    document.getElementById(`water-history-${next}-tab`)?.focus();
  }
  function dayKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    document.getElementById(`water-day-${Math.max(0, Math.min(days.length - 1, index + delta))}`)?.focus();
  }

  return (
    <div className="flex h-full w-full flex-col px-5 py-4 text-white">
      <header className="mb-2 flex shrink-0 items-start justify-between">
        <div><h2 className="text-[15px] font-semibold">喝水记录</h2><p className="mt-0.5 text-[10px] text-white/40">近 90 天 · 普通 / 游戏模式合计</p></div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onBack} className="rounded-lg px-2 py-1 text-[11px] text-white/55 hover:bg-white/10 hover:text-white">返回设置</button>
          <button type="button" onClick={onClose} aria-label="关闭喝水记录" className="rounded-full px-2 py-0.5 text-lg text-white/45 hover:bg-white/10 hover:text-white">×</button>
        </div>
      </header>
      <div role="tablist" aria-label="喝水记录图表" className="mb-2 flex shrink-0 gap-1 rounded-xl bg-white/[0.06] p-1">
        {(["heatmap", "trend"] as const).map(value => (
          <button key={value} id={`water-history-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls="water-history-chart" tabIndex={tab === value ? 0 : -1} onClick={() => changeTab(value)} onKeyDown={tabKeys}
            className={`flex-1 rounded-lg py-1 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-sky-300 ${tab === value ? "bg-sky-400/15 text-sky-300" : "text-white/40 hover:text-white/75"}`}>
            {value === "heatmap" ? "贡献图" : "趋势图"}
          </button>
        ))}
      </div>
      <div className="mb-2 grid shrink-0 grid-cols-3 divide-x divide-white/10 text-center">
        {[["累计喝水", `${total}`, "次"], ["有记录喝水", `${activeDays}`, "天"], ["日均次数", knownDays ? (total / knownDays).toFixed(1) : "—", "次"]].map(([label, value, unit]) => (
          <div key={label}><span className="text-[17px] font-semibold tabular-nums text-sky-200">{value}</span><span className="ml-1 text-[9px] text-white/35">{unit}</span><p className="text-[9px] text-white/40">{label}</p></div>
        ))}
      </div>
      <div id="water-history-chart" role="tabpanel" aria-labelledby={`water-history-${tab}-tab`} className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/[0.035] px-2 py-2">
        {tab === "heatmap" ? (
          <div className="mx-auto w-fit" onMouseLeave={() => setHovered(null)}>
            <div className="mb-1 ml-5 grid h-3 text-[9px] text-white/40" style={{ gridTemplateColumns: `repeat(${weeks}, 14px)`, gap: 4 }}>
              {Array.from({ length: weeks }, (_, week) => {
                const index = Math.max(0, week * 7 - offset);
                const month = days[index]?.date.slice(5, 7);
                const previous = week ? days[Math.max(0, (week - 1) * 7 - offset)]?.date.slice(5, 7) : null;
                return <span key={week} className="whitespace-nowrap">{month !== previous ? `${Number(month)}月` : ""}</span>;
              })}
            </div>
            <div className="flex gap-1">
              <div aria-hidden="true" className="grid w-4 text-[9px] leading-3.5 text-white/30" style={{ gridTemplateRows: "repeat(7, 14px)", gap: 4 }}>{["一", "", "三", "", "五", "", "日"].map((day, i) => <span key={i}>{day}</span>)}</div>
              <div className="grid" style={{ gridAutoFlow: "column", gridTemplateRows: "repeat(7, 14px)", gridTemplateColumns: `repeat(${weeks}, 14px)`, gap: 4 }}>
                {Array.from({ length: weeks * 7 }, (_, cell) => {
                  const index = cell - offset;
                  const day = days[index];
                  if (!day) return <span key={cell} aria-hidden="true" />;
                  return <button key={cell} id={`water-day-${index}`} type="button" aria-label={description(index)} aria-describedby="water-history-detail" title={description(index)}
                    onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => setHovered(index)} onKeyDown={event => dayKeys(event, index)}
                    className={`h-3.5 w-3.5 rounded-[3px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-200 ${day.date === today ? "border-sky-200/80" : day.known ? "border-white/5" : "border-dashed border-white/10"} ${hovered === index ? "ring-1 ring-white/80" : ""}`}
                    style={{ backgroundColor: day.known ? BLUE[level(day.count)] : "transparent" }} />;
                })}
              </div>
            </div>
          </div>
        ) : (
          <svg viewBox="0 0 360 145" className="h-full min-h-[145px] w-full" aria-label="近 90 天每日喝水次数趋势" onMouseLeave={() => setHovered(null)}>
            {[0, Math.ceil(max / 2), max].map(tick => <g key={tick}><line x1="28" x2="346" y1={y(tick)} y2={y(tick)} stroke="white" strokeOpacity="0.08" strokeDasharray="3 4" /><text x="21" y={y(tick) + 3} textAnchor="end" fill="#ffffff66" fontSize="9">{tick}</text></g>)}
            {segments.map((path, i) => <path key={i} d={path} fill="none" stroke="#55b4ff" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />)}
            {days.map((day, i) => day.known && <circle key={day.date} cx={x(i)} cy={y(day.count)} r="1.6" fill="#83caff" />)}
            {selected.known && <g><line x1={x(hovered ?? 89)} x2={x(hovered ?? 89)} y1="15" y2="122" stroke="#83caff" strokeOpacity="0.4" strokeDasharray="3 3" /><circle cx={x(hovered ?? 89)} cy={y(selected.count)} r="3.5" fill="#83caff" stroke="#102a44" strokeWidth="2" /></g>}
            {[0, 29, 59, 89].map(i => <text key={i} x={x(i)} y="140" textAnchor={i === 0 ? "start" : i === 89 ? "end" : "middle"} fill="#ffffff66" fontSize="9">{shortDate(days[i].date)}</text>)}
            {days.map((day, i) => <rect key={day.date} x={x(i) - 1.8} y="12" width="3.6" height="114" fill="transparent" tabIndex={0} role="button" aria-label={description(i)} onMouseEnter={() => setHovered(i)} onFocus={() => setHovered(i)} onBlur={() => setHovered(null)} onClick={() => setHovered(i)}><title>{description(i)}</title></rect>)}
          </svg>
        )}
      </div>
      <div id="water-history-detail" role="status" className="mt-1.5 shrink-0 text-center text-[10px] tabular-nums text-sky-200">
        {selected.date} · {selected.known ? `喝水 ${selected.count} 次` : "未记录"}
      </div>
      <footer className="mt-1 flex shrink-0 items-center justify-between text-[9px] text-white/35">
        <span>确认喝水后计入 · 虚线 / 空缺表示未记录</span>
        {tab === "heatmap" && <span className="flex items-center gap-1">少{BLUE.map(color => <i key={color} className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />)}多</span>}
      </footer>
    </div>
  );
}

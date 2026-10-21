import { useMemo, useRef, useState } from "react";

export type Series = { key: string; label: string; color: string };
export type Datum = { t: number; values: Record<string, number> };

export function formatCompact(n: number, lang: string) {
  return new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "Nice" axis ceiling and three gridline ticks for a max value. */
function niceTicks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return [0, step, step * 2, step * 3];
}

/**
 * Stacked bar chart over time. One y-axis, 2px gaps between stacked segments,
 * 4px rounded data ends, a legend, and a per-bar hover tooltip.
 */
export function StackedBars({ data, series, lang, formatTime, height = 180, emptyLabel }: { data: Datum[]; series: Series[]; lang: string; formatTime: (t: number) => string; height?: number; emptyLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const ticks = useMemo(() => niceTicks(Math.max(0, ...totals)), [totals]);
  const top = ticks[ticks.length - 1];
  const empty = totals.every((v) => v === 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        {/* Y axis labels */}
        <div className="relative w-10 shrink-0 text-right text-[10px] text-faint tabular-nums" style={{ height }}>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: height - (tick / top) * height }}>
              {formatCompact(tick, lang)}
            </span>
          ))}
        </div>
        <div ref={box} className="relative min-w-0 flex-1" style={{ height }} onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <div key={tick} className="absolute inset-x-0 border-t border-line" style={{ top: height - (tick / top) * height, borderStyle: tick === 0 ? "solid" : "dashed" }} />
          ))}
          {empty ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-faint">{emptyLabel}</div>
          ) : (
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {data.map((d, i) => (
                <div key={d.t} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                  {/* Wider invisible hit target than the mark itself */}
                  <div className={hover === i ? "absolute inset-0 rounded-md bg-surface-2/70" : "absolute inset-0"} />
                  <div className="relative flex w-full flex-col-reverse gap-[2px]">
                    {series.map((s, si) => {
                      const v = d.values[s.key] ?? 0;
                      if (!v) return null;
                      const isTop = series.slice(si + 1).every((other) => !(d.values[other.key] ?? 0));
                      return <div key={s.key} style={{ height: Math.max(2, (v / top) * height - 2), background: s.color, borderRadius: isTop ? "4px 4px 0 0" : 0 }} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {hover != null && !empty && (
            <div
              className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-panel"
              style={hover < data.length / 2 ? { left: `${((hover + 1) / data.length) * 100}%`, marginLeft: 8 } : { right: `${((data.length - hover) / data.length) * 100}%`, marginRight: 8 }}
            >
              <div className="mb-1 font-medium">{formatTime(data[hover].t)}</div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums">{(data[hover].values[s.key] ?? 0).toLocaleString(lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 ml-12 flex text-[10px] text-faint">
        {data.map((d, i) => (
          <span key={d.t} className="flex-1 truncate text-center">
            {i % labelEvery === 0 ? formatTime(d.t) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

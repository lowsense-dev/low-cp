import type { RecentBucket } from "../lib/api";

/** Tiny stacked bar chart of recent success/failure buckets. */
export function Sparkline({ buckets, width = 84, height = 22 }: { buckets: RecentBucket[]; width?: number; height?: number }) {
  const data = buckets.slice(-14);
  const max = Math.max(1, ...data.map((b) => b.success + b.failed));
  const gap = 2;
  const bar = data.length ? (width - gap * (data.length - 1)) / data.length : 0;
  const label = data.map((b) => `${b.time}: ${b.success}/${b.failed}`).join("\n");
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      {data.map((b, i) => {
        const x = i * (bar + gap);
        const total = b.success + b.failed;
        const h = total ? Math.max(2, (total / max) * height) : 2;
        const failH = total ? (b.failed / total) * h : 0;
        return (
          <g key={i}>
            <rect x={x} y={height - h} width={bar} height={h} rx={1} fill={total ? "var(--ok)" : "var(--border)"} opacity={total ? 0.85 : 1} />
            {failH > 0 && <rect x={x} y={height - h} width={bar} height={failH} rx={1} fill="var(--err)" />}
          </g>
        );
      })}
    </svg>
  );
}

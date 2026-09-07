import { useState } from "react";
import type { DailyUsagePoint } from "../../api/types";

const CHART_HEIGHT = 150;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;
const PAD_X = 4; // in viewBox units (viewBox width is 100, so 1 unit == 1%)

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Series {
  key: "total" | "prompt" | "completion";
  label: string;
  color: string;
  width: number;
  accessor: (p: DailyUsagePoint) => number;
}

const SERIES: Series[] = [
  { key: "total", label: "Total", color: "var(--color-fg)", width: 1.75, accessor: (p) => p.tokens },
  { key: "prompt", label: "Prompt", color: "var(--color-chart-2)", width: 1.25, accessor: (p) => p.prompt_tokens },
  { key: "completion", label: "Completion", color: "var(--color-chart-4)", width: 1.25, accessor: (p) => p.completion_tokens },
];

/** Quadratic midpoint smoothing between points — cheap, and enough to keep a
 *  14-point line from reading as a sawtooth. */
function smoothPath(points: readonly (readonly [number, number])[]): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    d += ` Q ${px} ${py} ${(px + cx) / 2} ${(py + cy) / 2}`;
  }
  const [lx, ly] = points[points.length - 1];
  d += ` L ${lx} ${ly}`;
  return d;
}

/**
 * Daily prompt / completion / total tokens, drawn as three hairlines over a
 * dashed baseline — the same spare language as the live monitor's Sparkline.
 *
 * The frame (baseline + lines) lives in a stretched SVG so it fills the width;
 * every point marker, the crosshair and the tooltip are plain positioned HTML
 * on top of it, so they stay perfectly round and readable regardless of how
 * far the SVG is stretched. (The old version drew markers as SVG rects inside
 * a `preserveAspectRatio="none"` viewBox, which squashed them into slivers and
 * let the tooltip fall off the edges.)
 */
export function TokenTimeseriesChart({ data }: { data: DailyUsagePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length === 0) return null;

  const vbWidth = 100;
  const max = Math.max(1, ...data.map((d) => d.tokens));
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const baseline = CHART_HEIGHT - PAD_BOTTOM;

  const stepX = data.length > 1 ? (vbWidth - PAD_X * 2) / (data.length - 1) : 0;
  const xAt = (i: number) => (data.length > 1 ? PAD_X + i * stepX : vbWidth / 2);
  const yAt = (value: number) => PAD_TOP + plotH * (1 - value / max);
  const hitWidth = data.length > 1 ? stepX : vbWidth - PAD_X * 2;

  const markerIndex = hoverIndex ?? data.length - 1;
  const markerPoint = data[markerIndex];

  return (
    <div className="relative w-full select-none">
      <div className="mb-3 flex items-center gap-4">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[0.6875rem] text-fg-secondary">
            <span className="h-[3px] w-3.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.label}
          </div>
        ))}
      </div>

      <div className="relative" style={{ height: CHART_HEIGHT }}>
        <svg
          viewBox={`0 0 ${vbWidth} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={`Token usage over ${data.length} days, peak ${max.toLocaleString()} tokens`}
        >
          <line
            x1="0"
            x2={vbWidth}
            y1={baseline}
            y2={baseline}
            stroke="var(--color-border)"
            strokeWidth="1"
            strokeDasharray="1.4 2.6"
            vectorEffect="non-scaling-stroke"
          />

          {hoverIndex !== null && (
            <line
              x1={xAt(hoverIndex)}
              x2={xAt(hoverIndex)}
              y1={PAD_TOP - 4}
              y2={baseline}
              stroke="var(--color-fg-muted)"
              strokeWidth="1"
              strokeDasharray="1 1.6"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {SERIES.map((series) => {
            const points = data.map((point, i) => [xAt(i), yAt(series.accessor(point))] as const);
            return (
              <path
                key={series.key}
                d={smoothPath(points)}
                fill="none"
                stroke={series.color}
                strokeWidth={series.width}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
                opacity={hoverIndex !== null && series.key !== "total" ? 0.5 : 1}
                style={{ transition: "opacity 150ms cubic-bezier(0.32,0.72,0,1)" }}
              />
            );
          })}

          {data.map((point, i) => (
            <rect
              key={point.date}
              x={xAt(i) - hitWidth / 2}
              y="0"
              width={hitWidth}
              height={CHART_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          ))}
        </svg>

        {/* Markers: HTML, so they stay round under the stretched SVG. */}
        <div className="pointer-events-none absolute inset-0">
          {SERIES.map((series) => (
            <span
              key={series.key}
              className="absolute rounded-full ring-2 ring-surface"
              style={{
                left: `${xAt(markerIndex)}%`,
                top: yAt(series.accessor(markerPoint)),
                width: 9,
                height: 9,
                backgroundColor: series.color,
                transform: `translate(-50%, -50%) scale(${hoverIndex === null ? 0.6 : 1})`,
                transition: "transform 150ms cubic-bezier(0.32,0.72,0,1)",
              }}
            />
          ))}
        </div>

        {hoverIndex !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[7.5rem] rounded-md border border-border bg-surface px-2.5 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_14px_30px_-14px_rgba(0,0,0,0.2)]"
            style={{
              left: `${xAt(hoverIndex)}%`,
              top: -8,
              transform: `translate(${
                xAt(hoverIndex) < 22 ? "0" : xAt(hoverIndex) > 78 ? "-100%" : "-50%"
              }, -100%)`,
            }}
          >
            <div className="text-[0.625rem] tracking-[0.14em] text-fg-soft">
              {formatShortDate(data[hoverIndex].date)}
            </div>
            <div className="pot-num mt-1 text-sm font-semibold text-fg">
              {data[hoverIndex].tokens.toLocaleString()} total
            </div>
            <div className="mt-1 flex flex-col gap-0.5 text-[0.6875rem] text-fg-soft">
              <span className="pot-num">{data[hoverIndex].prompt_tokens.toLocaleString()} prompt</span>
              <span className="pot-num">{data[hoverIndex].completion_tokens.toLocaleString()} completion</span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-between text-[0.625rem] text-fg-soft">
        <span>{formatShortDate(data[0].date)}</span>
        <span>{formatShortDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

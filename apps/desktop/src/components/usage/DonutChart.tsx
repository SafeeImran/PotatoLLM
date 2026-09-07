import { type CSSProperties, useId, useState } from "react";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  size?: number;
  /** Ring thickness in SVG user units (viewBox is 0–100). */
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}

const GAP_DEGREES = 2.5; // the mark spec's 2px surface gap, expressed as an angular gap for a ring this thin

/**
 * A single ring built from per-segment arcs (not stroke-dasharray on one
 * circle) so each segment can carry its own hover state and an accessible
 * gap between neighbors, per the dataviz skill's "surface gap" spacer.
 */
export function DonutChart({ segments, size = 160, thickness = 16, centerLabel, centerValue }: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const gradientId = useId();

  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 50 - thickness / 2;
  const cx = 50;
  const cy = 50;

  let cursor = -90; // start at 12 o'clock
  const arcs = segments.map((segment, i) => {
    const fraction = total > 0 ? segment.value / total : 0;
    const sweep = fraction * 360;
    const start = cursor + GAP_DEGREES / 2;
    const end = cursor + sweep - GAP_DEGREES / 2;
    cursor += sweep;
    return { ...segment, start, end: Math.max(start, end), pct: fraction * 100, index: i };
  });

  function arcPath(startDeg: number, endDeg: number): string {
    const toXY = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)] as const;
    };
    const [x1, y1] = toXY(startDeg);
    const [x2, y2] = toXY(endDeg);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  if (total <= 0) {
    return (
      <div className="flex items-center justify-center text-xs text-fg-soft" style={{ width: size, height: size }}>
        No data yet
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Token breakdown">
        <defs>
          <clipPath id={gradientId}>
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>
        </defs>
        {arcs.map((arc) => {
          const sweepDeg = Math.max(0, arc.end - arc.start);
          const arcLen = (sweepDeg / 360) * 2 * Math.PI * radius;
          return (
            <path
              key={arc.label}
              d={arcPath(arc.start, arc.end)}
              fill="none"
              stroke={arc.color}
              strokeWidth={hovered === arc.index ? thickness + 2 : thickness}
              strokeLinecap="round"
              className="pot-donut-draw transition-[stroke-width] duration-100"
              style={{
                "--pot-arc-len": arcLen,
                strokeDasharray: arcLen,
                strokeDashoffset: 0,
                animationDelay: `${arc.index * 0.1}s`,
              } as CSSProperties}
              onMouseEnter={() => setHovered(arc.index)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </svg>

      {(centerLabel || centerValue || hovered !== null) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {hovered !== null ? (
            <>
              <div className="font-mono text-sm font-semibold text-fg">{arcs[hovered].value.toLocaleString()}</div>
              <div className="max-w-[80%] truncate text-[0.625rem] text-fg-soft">{arcs[hovered].label}</div>
            </>
          ) : (
            <>
              {centerValue && <div className="font-mono text-lg font-semibold text-fg">{centerValue}</div>}
              {centerLabel && <div className="text-[0.625rem] tracking-wide text-fg-soft">{centerLabel}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

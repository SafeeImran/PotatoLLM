interface SparklineProps {
  values: number[];
  height?: number;
  /** Never scale below this, so an idle all-zero window draws a flat floor. */
  floor?: number;
  /** Squares off the leading marker while a generation is streaming. */
  live?: boolean;
  /** Line/head color — defaults to the live-monitor accent dot. Lets stat
   * cards elsewhere (e.g. Usage) tint their trend line per metric. */
  color?: string;
}

/**
 * Throughput plot for the live monitor.
 *
 * Deliberately spare: one hairline, a dashed baseline and a square head marker,
 * no fill and no gridlines. The dashes reuse the same broken-rule language as
 * the parameter sliders, which is where the panel gets its terminal feel from —
 * the drawing does not have to shout to read as technical.
 */
export function Sparkline({ values, height = 64, floor = 1, live = false, color = "var(--pot-accent-dot)" }: SparklineProps) {
  const width = 300;
  const padding = 5;

  const series = values.length >= 2 ? values : [0, 0];
  const peak = Math.max(floor, ...series);
  const stepX = width / (series.length - 1);
  const plotHeight = height - padding * 2;
  const baseline = height - padding;

  const points = series.map((value, index) => {
    const x = index * stepX;
    const y = padding + plotHeight * (1 - Math.max(0, value) / peak);
    return [x, y] as const;
  });

  // Quadratic midpoint smoothing: cheaper than a spline fit and enough to stop
  // a 250 ms sampling cadence from looking like a sawtooth.
  let line = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    line += ` Q ${px} ${py} ${(px + cx) / 2} ${(py + cy) / 2}`;
  }
  line += ` L ${points[points.length - 1][0]} ${points[points.length - 1][1]}`;

  const [headX, headY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={`Throughput, peak ${peak.toFixed(1)} tokens per second`}
      style={{ display: "block", overflow: "visible" }}
    >
      <line
        x1="0"
        x2={width}
        y1={baseline}
        y2={baseline}
        stroke="var(--pot-ghost)"
        strokeWidth="1"
        strokeDasharray="2 5"
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Square rather than round: it echoes the ▪ markers used elsewhere, and
          a 3px box survives the horizontal viewBox stretch without going oval. */}
      <rect
        x={headX - 1.5}
        y={headY - 1.5}
        width="3"
        height="3"
        fill={color}
        style={{ animation: live ? "potPulseHead 1.2s ease-in-out infinite" : undefined }}
      />
    </svg>
  );
}

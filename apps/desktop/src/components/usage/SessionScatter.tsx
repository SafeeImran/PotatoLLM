import { useMemo, useState } from "react";
import type { RecentSession } from "../../api/types";
import { formatDuration, formatTimeAgo } from "../../lib/format";
import { MODEL_COLOR_OTHER } from "./modelColor";

/**
 * Every recorded session placed on a speed / latency field: throughput runs
 * left → right, time-to-first-token runs top (quick) → bottom (slow), so the
 * best runs settle into the top-right. Dot area is the session's token count,
 * dot colour is its model (same palette as the "by model" donut).
 *
 * Interactive: hover or focus a dot to read it and light up its model's other
 * runs; click to pin that readout so you can move the mouse away. Median
 * guides appear once there are enough sessions for a middle to mean something.
 */

const CHART_H = 208;
const PAD_T = 14;
const PAD_B = 30;
const PAD_L = 7; // viewBox units (width is 100)
const PAD_R = 5;

interface Props {
  sessions: RecentSession[];
  modelColors: Map<string, string>;
}

export function SessionScatter({ sessions, modelColors }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const plottable = useMemo(
    () => sessions.filter((s) => s.avg_tokens_per_sec != null && s.avg_ttft_seconds != null),
    [sessions],
  );

  const geom = useMemo(() => {
    if (plottable.length === 0) return null;

    const tpsVals = plottable.map((s) => s.avg_tokens_per_sec as number);
    const ttftVals = plottable.map((s) => s.avg_ttft_seconds as number);
    const maxTok = Math.max(1, ...plottable.map((s) => Math.max(0, s.total_tokens)));

    const xMax = Math.max(1, ...tpsVals) * 1.12;
    const yMax = Math.max(0.05, ...ttftVals) * 1.15;

    const plotW = 100 - PAD_L - PAD_R;
    const plotH = CHART_H - PAD_T - PAD_B;
    const projX = (tps: number) => PAD_L + (tps / xMax) * plotW;
    const projY = (ttft: number) => PAD_T + (ttft / yMax) * plotH;
    const radius = (tok: number) => 3.5 + Math.sqrt(Math.max(0, tok) / maxTok) * 5;

    const points = plottable.map((s) => ({
      s,
      tps: s.avg_tokens_per_sec as number,
      ttft: s.avg_ttft_seconds as number,
      x: projX(s.avg_tokens_per_sec as number),
      y: projY(s.avg_ttft_seconds as number),
      r: radius(s.total_tokens),
      color: modelColors.get(s.model_id ?? "") ?? MODEL_COLOR_OTHER,
    }));

    const median = (arr: number[]) => {
      const a = [...arr].sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)];
    };

    return {
      points,
      xMax,
      yMax,
      projX,
      projY,
      tpsMedian: median(tpsVals),
      ttftMedian: median(ttftVals),
      showMedians: plottable.length >= 4,
    };
  }, [plottable, modelColors]);

  if (sessions.length === 0) {
    return <p className="text-sm text-fg-soft">No sessions recorded yet.</p>;
  }
  if (!geom) {
    return (
      <p className="text-sm text-fg-soft">Sessions need a measured speed and first-token time before they can be mapped.</p>
    );
  }

  const { points, xMax, yMax, projX, projY, tpsMedian, ttftMedian, showMedians } = geom;
  const shownId = hoverId ?? pinnedId;
  const shown = points.find((p) => p.s.session_id === shownId) ?? null;
  const shownModel = shown?.s.model_id ?? null;
  const excluded = sessions.length - plottable.length;

  return (
    <div className="relative w-full select-none">
      <div className="relative" style={{ height: CHART_H }}>
        <svg
          viewBox={`0 0 100 ${CHART_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {/* axes */}
          <line
            x1={PAD_L}
            y1={PAD_T - 4}
            x2={PAD_L}
            y2={CHART_H - PAD_B}
            stroke="var(--color-border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={PAD_L}
            y1={CHART_H - PAD_B}
            x2={100 - PAD_R}
            y2={CHART_H - PAD_B}
            stroke="var(--color-border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {showMedians && (
            <>
              <line
                x1={projX(tpsMedian)}
                y1={PAD_T - 4}
                x2={projX(tpsMedian)}
                y2={CHART_H - PAD_B}
                stroke="var(--color-fg-muted)"
                strokeWidth="1"
                strokeDasharray="1.5 2.5"
                opacity="0.45"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={PAD_L}
                y1={projY(ttftMedian)}
                x2={100 - PAD_R}
                y2={projY(ttftMedian)}
                stroke="var(--color-fg-muted)"
                strokeWidth="1"
                strokeDasharray="1.5 2.5"
                opacity="0.45"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}

          {shown && (
            <>
              <line
                x1={shown.x}
                y1={shown.y}
                x2={shown.x}
                y2={CHART_H - PAD_B}
                stroke={shown.color}
                strokeWidth="1"
                strokeDasharray="1.5 2"
                opacity="0.6"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={PAD_L}
                y1={shown.y}
                x2={shown.x}
                y2={shown.y}
                stroke={shown.color}
                strokeWidth="1"
                strokeDasharray="1.5 2"
                opacity="0.6"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Dots: HTML, so they stay round under the stretched SVG. */}
        <div className="absolute inset-0">
          {points.map((p) => {
            const isShown = p.s.session_id === shownId;
            const dimmed = shownModel != null && !isShown && p.s.model_id !== shownModel;
            return (
              <button
                key={p.s.session_id}
                type="button"
                aria-label={`${p.s.model_name ?? "Unknown model"} session, ${p.tps.toFixed(
                  0,
                )} tokens per second, ${p.ttft.toFixed(2)} second first token`}
                className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                style={{
                  left: `${p.x}%`,
                  top: p.y,
                  width: p.r * 2,
                  height: p.r * 2,
                  marginLeft: -p.r,
                  marginTop: -p.r,
                  backgroundColor: p.color,
                  color: p.color,
                  opacity: dimmed ? 0.18 : isShown ? 1 : 0.82,
                  transform: `scale(${isShown ? 1.35 : 1})`,
                  boxShadow: isShown
                    ? "0 0 0 3px var(--color-surface), 0 0 0 4.5px currentColor"
                    : "0 0 0 2px var(--color-surface)",
                  transition: "transform 200ms cubic-bezier(0.32,0.72,0,1), opacity 200ms cubic-bezier(0.32,0.72,0,1)",
                }}
                onMouseEnter={() => setHoverId(p.s.session_id)}
                onMouseLeave={() => setHoverId(null)}
                onFocus={() => setHoverId(p.s.session_id)}
                onBlur={() => setHoverId(null)}
                onClick={() => setPinnedId((cur) => (cur === p.s.session_id ? null : p.s.session_id))}
              />
            );
          })}
        </div>

        {/* corner hint */}
        <div className="pointer-events-none absolute right-1 top-0 text-[0.5625rem] tracking-[0.16em] text-fg-soft">
          faster ↗
        </div>

        {shown &&
          (() => {
            const flipDown = shown.y < 82;
            const hx = shown.x > 68 ? "-100%" : shown.x < 32 ? "0" : "-50%";
            return (
              <div
                className="pointer-events-none absolute z-10 min-w-[9.5rem] rounded-md border border-border bg-surface px-3 py-2 shadow-[0_2px_4px_rgba(0,0,0,0.04),0_16px_34px_-16px_rgba(0,0,0,0.22)]"
                style={{
                  left: `${shown.x}%`,
                  top: flipDown ? shown.y + 14 : shown.y - 12,
                  transform: `translate(${hx}, ${flipDown ? "0" : "-100%"})`,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: shown.color }} />
                  <span className="truncate text-xs font-medium text-fg">{shown.s.model_name ?? "Unknown model"}</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[0.6875rem]">
                  <dt className="text-fg-soft">Speed</dt>
                  <dd className="pot-num text-right text-fg">{shown.tps.toFixed(1)} tok/s</dd>
                  <dt className="text-fg-soft">First token</dt>
                  <dd className="pot-num text-right text-fg">{shown.ttft.toFixed(2)} s</dd>
                  <dt className="text-fg-soft">Tokens</dt>
                  <dd className="pot-num text-right text-fg">{shown.s.total_tokens.toLocaleString()}</dd>
                  <dt className="text-fg-soft">Length</dt>
                  <dd className="pot-num text-right text-fg">{formatDuration(shown.s.duration_seconds)}</dd>
                </dl>
                <div className="mt-1.5 text-[0.5625rem] tracking-[0.12em] text-fg-soft">
                  {formatTimeAgo(shown.s.last_activity_at)}
                  {pinnedId === shown.s.session_id ? " · pinned" : ""}
                </div>
              </div>
            );
          })()}
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[0.625rem] text-fg-soft">
        <span>0</span>
        <span>tokens / sec →</span>
        <span className="pot-num">{Math.round(xMax)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.625rem] text-fg-soft">
        <span>
          {plottable.length} session{plottable.length === 1 ? "" : "s"} · vertical axis is first-token time, 0–
          <span className="pot-num">{yMax.toFixed(1)}</span>s
        </span>
        {excluded > 0 && (
          <span>
            {excluded} hidden — no timing recorded
          </span>
        )}
      </div>
    </div>
  );
}

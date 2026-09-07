import clsx from "clsx";
import type { CSSProperties } from "react";
import type { Tone } from "./Badge";

interface ProgressBarProps {
  value: number; // 0-1
  tone?: Tone;
  className?: string;
  label?: string;
}

/** Full-strength palette colour per tone — the dashed fill and head marker
 *  both draw in it (see `.pot-progress-*` in potato.css). */
const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--pot-faint)",
  accent: "var(--pot-progress-accent)",
  potato: "var(--pot-progress-accent)",
  success: "var(--pot-ok)",
  warning: "var(--pot-progress-accent)",
  danger: "var(--pot-danger)",
};

/**
 * Borrows the Live Monitor sliders' vocabulary: a bracketed `[ ]` dashed
 * track with a thin head marker at the fill edge, rather than a solid rounded
 * pill.
 */
export function ProgressBar({ value, tone = "accent", className, label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={clsx("w-full", className)}>
      {label && <div className="mb-1 text-xs text-fg-secondary">{label}</div>}
      <div className="pot-progress" style={{ "--pot-progress-tone": TONE_COLOR[tone] } as CSSProperties}>
        <span className="pot-progress-bracket" aria-hidden="true">
          [
        </span>
        <div
          className="pot-progress-track"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="pot-progress-fill" style={{ width: `${pct}%` }} />
          <span className="pot-progress-head" style={{ left: `${pct}%` }} />
        </div>
        <span className="pot-progress-bracket" aria-hidden="true">
          ]
        </span>
      </div>
    </div>
  );
}

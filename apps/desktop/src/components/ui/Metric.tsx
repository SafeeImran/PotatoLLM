import clsx from "clsx";
import type { ReactNode } from "react";

interface MetricProps {
  value: ReactNode;
  unit?: string;
  label: string;
  provenance?: "measured" | "estimated";
  size?: "md" | "lg";
  className?: string;
}

/**
 * Every performance number in the app renders through this component so
 * measured-vs-estimated provenance is never dropped silently (spec section 44).
 */
export function Metric({ value, unit, label, provenance, size = "md", className }: MetricProps) {
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      <div className={clsx("font-mono font-semibold text-fg", size === "lg" ? "text-3xl" : "text-xl")}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-fg-secondary">{unit}</span>}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-fg-secondary">
        <span className="capitalize tracking-wide">{label}</span>
        {provenance && (
          <span
            className={clsx(
              "rounded-sm px-1 text-[10px] uppercase tracking-wide",
              provenance === "measured" ? "bg-success-muted text-success" : "bg-surface-elevated text-fg-muted",
            )}
          >
            {provenance === "measured" ? "Measured" : "Estimated"}
          </span>
        )}
      </div>
    </div>
  );
}

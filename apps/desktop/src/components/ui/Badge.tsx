import type { HTMLAttributes } from "react";
import clsx from "clsx";

export type Tone = "neutral" | "accent" | "potato" | "success" | "warning" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

/**
 * The app's status label. One treatment everywhere (see `.pot-tag` in
 * potato.css): a machined index label — no fill, hairline border in the
 * label's own full-strength colour, one clipped corner, a leading tick,
 * monospace all-caps. Deliberately not a rounded, tinted pill.
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={clsx("pot-tag", className)}
      data-tone={tone === "neutral" ? undefined : tone}
      {...props}
    />
  );
}

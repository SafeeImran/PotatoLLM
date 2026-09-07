import { useRecommendation } from "../../hooks/useRecommendation";
import type { CompatibilityLevel } from "../../api/types";

const DOT: Record<CompatibilityLevel, string> = {
  GREEN: "bg-success",
  YELLOW: "bg-warning",
  RED: "bg-danger",
};

const LABEL: Record<CompatibilityLevel, string> = {
  GREEN: "Runs comfortably",
  YELLOW: "Runs with compromises",
  RED: "Not recommended",
};

/**
 * Honest by design: renders nothing until a real hardware profile exists to
 * compare against — never a placeholder guess.
 *
 * Drawn as a small dot plus the level word rather than a filled pill: on a
 * catalog of 30-odd rows a coloured pill per row reads as noise, a dot reads
 * as a status.
 */
export function CompatibilityBadge({ modelId }: { modelId: string }) {
  const { data, isError } = useRecommendation(modelId);
  const level = data?.recommended?.compatibility;
  if (isError || !level) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-fg-secondary"
      title={`${LABEL[level]} — estimated from your detected hardware`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[level]}`} aria-hidden="true" />
      {level}
    </span>
  );
}

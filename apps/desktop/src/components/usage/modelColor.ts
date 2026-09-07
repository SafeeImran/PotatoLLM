/**
 * Deterministic model → color assignment shared by the "Tokens by Model"
 * donut and the Recent Sessions table, so the same model always reads as
 * the same swatch across the page. Fixed categorical order (dataviz skill:
 * "assign categorical hues in fixed order, never cycled") — a model's color
 * comes from its rank by total tokens (assigned by the caller), not a hash,
 * so the biggest consumers always land on the earliest, most-separated slots.
 */
const MODEL_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)"];
export const MODEL_COLOR_OTHER = "var(--color-fg-muted)";

export function modelColorForRank(rank: number): string {
  return MODEL_COLORS[rank] ?? MODEL_COLOR_OTHER;
}

/** Maps each model_id to its donut-slot color, ranked by the by-model
 * breakdown's own order (already sorted by total tokens, most-used first) —
 * so a session row's dot matches the color that same model got in the donut. */
export function buildModelColorMap(byModel: { model_id: string }[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  (byModel ?? []).forEach((m, i) => map.set(m.model_id, modelColorForRank(i)));
  return map;
}

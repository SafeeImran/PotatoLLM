/** Compact token counts for the sidebar/monitor readouts: 1284 -> "1.3k". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

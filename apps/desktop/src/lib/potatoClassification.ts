/** Shared mapping so the classification string always renders the same way everywhere. */
const ORDER = ["Tiny Potato", "Potato", "Capable Potato", "Serious Potato", "Potato Beast"] as const;

export type PotatoClassification = (typeof ORDER)[number];

export function classificationRank(classification: string): number {
  const idx = ORDER.indexOf(classification as PotatoClassification);
  return idx === -1 ? 0 : idx;
}

export function classificationTone(classification: string): "danger" | "warning" | "accent" | "success" {
  const rank = classificationRank(classification);
  if (rank <= 0) return "danger";
  if (rank === 1) return "warning";
  if (rank <= 3) return "accent";
  return "success";
}

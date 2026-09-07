import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * Used by every nav section that isn't built yet. Renders an honest
 * "not built" state — never fake data or invented metrics (spec section 51).
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm font-medium text-fg-secondary">{title}</div>
      {description && <div className="max-w-sm text-xs text-fg-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

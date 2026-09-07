import clsx from "clsx";

type Status = "ready" | "running" | "busy" | "error" | "offline";

interface StatusIndicatorProps {
  status: Status;
  label: string;
  className?: string;
}

const DOT_CLASSES: Record<Status, string> = {
  ready: "bg-success",
  running: "bg-accent animate-pulse",
  busy: "bg-potato animate-pulse",
  error: "bg-danger",
  offline: "bg-fg-muted",
};

export function StatusIndicator({ status, label, className }: StatusIndicatorProps) {
  return (
    <div className={clsx("flex items-center gap-2 text-xs text-fg-secondary", className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", DOT_CLASSES[status])} />
      <span className="tracking-wide">{label}</span>
    </div>
  );
}

import type { TextareaHTMLAttributes } from "react";
import clsx from "clsx";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        "rounded-md border border-border-strong bg-surface-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        "resize-none",
        className,
      )}
      {...props}
    />
  );
}

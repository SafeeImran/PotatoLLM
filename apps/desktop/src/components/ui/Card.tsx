import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  action?: ReactNode;
  padded?: boolean;
}

export function Card({ title, action, padded = true, className, children, ...props }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-border bg-surface pot-fade-up",
        padded && "p-4",
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-sm font-medium text-fg-secondary tracking-wide capitalize">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

import { cn } from "@/lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  /** Right-aligned header content (actions). */
  headerRight?: React.ReactNode;
};

/** Surface panel with consistent border/radius/padding (PRD FR-DS-1). */
export function Card({ title, headerRight, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn("rounded-md border border-border bg-surface p-4", className)}
      {...rest}
    >
      {(title || headerRight) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="text-sm font-semibold text-text">{title}</h3>}
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}

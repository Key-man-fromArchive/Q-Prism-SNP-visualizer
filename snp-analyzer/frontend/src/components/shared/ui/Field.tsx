import { useId } from "react";
import { cn } from "@/lib/utils";

export type FieldProps = {
  label: string;
  children: (id: string) => React.ReactNode;
  hint?: string;
  className?: string;
  /** Lay label and control on one row instead of stacked. */
  inline?: boolean;
};

/**
 * Labelled form field wrapper that wires htmlFor/id automatically (PRD FR-DS-1).
 * `children` receives the generated id to spread onto the control.
 */
export function Field({ label, children, hint, className, inline }: FieldProps) {
  const id = useId();
  return (
    <div className={cn(inline ? "flex items-center gap-2" : "flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

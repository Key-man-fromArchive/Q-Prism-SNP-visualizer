import { forwardRef } from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./variants";

/**
 * Generic application-action button. All buttons that trigger an app action
 * should go through this (or IconButton) so styling, focus, disabled and dark
 * mode stay consistent (PRD FR-DS-1, M3). Semantic composites (tabs, plate-well
 * cells, menu items, Plotly controls) are intentionally NOT built on this.
 */
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Show a spinner and disable while true. */
    loading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="w-3.5 h-3.5 border-2 border-current border-r-transparent rounded-full animate-spin"
        />
      )}
      {children}
    </button>
  );
});

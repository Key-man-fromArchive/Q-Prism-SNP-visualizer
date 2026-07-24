import { forwardRef } from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { iconButtonVariants } from "./variants";

/**
 * Icon-only button. `aria-label` is required (enforced by the type) so the
 * control always has an accessible name (PRD NFR-DS-5).
 */
export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required accessible name for the icon-only control. */
    "aria-label": string;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size, type = "button", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ size }), className)}
      {...rest}
    >
      {children}
    </button>
  );
});

import { cva } from "class-variance-authority";

/** Shared cva definitions for the UI primitives (kept in a component-free
 *  module so react-refresh/fast-refresh stays happy). */

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap " +
    "cursor-pointer transition-colors select-none " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface " +
    "disabled:opacity-50 disabled:cursor-default disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary-hover",
        secondary:
          "bg-surface text-text border border-border hover:border-primary hover:text-primary",
        ghost: "bg-transparent text-text-muted hover:text-text hover:bg-bg",
        danger: "bg-danger text-white hover:opacity-90",
      },
      size: {
        sm: "text-xs px-2.5 py-1",
        md: "text-sm px-4 py-1.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-md cursor-pointer transition-colors " +
    "text-text-muted hover:text-primary hover:bg-bg " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface " +
    "disabled:opacity-40 disabled:cursor-default disabled:pointer-events-none",
  {
    variants: {
      size: {
        sm: "w-7 h-7",
        md: "w-8 h-8",
      },
    },
    defaultVariants: { size: "md" },
  }
);

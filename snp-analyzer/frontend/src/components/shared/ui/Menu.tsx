import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

export type MenuItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

export type MenuProps = {
  /** Rendered inside the trigger button. */
  trigger: React.ReactNode;
  items: MenuItem[];
  /** Accessible name for the trigger (used as aria-label + tooltip). */
  label: string;
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
};

/**
 * Lightweight accessible dropdown menu (PRD FR-DS-1). Keyboard: Enter/Space/↓
 * opens, ↑/↓ move, Enter/Space select, Esc closes and restores focus, outside
 * click closes. Not for tab bars or well grids (those are semantic composites).
 */
export function Menu({ trigger, items, label, align = "end", className, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Outside click / focus-out closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Move DOM focus to the active item while open.
  useEffect(() => {
    if (open) itemRefs.current[activeIdx]?.focus();
  }, [open, activeIdx]);

  const openMenu = (idx = 0) => {
    setActiveIdx(idx);
    setOpen(true);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(items.length - 1);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(items.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect();
    close();
  };

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? setOpen(false) : openMenu(0))}
        onKeyDown={onTriggerKey}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-sm font-medium px-3 py-1.5 cursor-pointer transition-colors",
          "bg-surface text-text border border-border hover:border-primary hover:text-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          triggerClassName
        )}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            "absolute z-50 mt-1 min-w-[10rem] rounded-md border border-border bg-surface py-1 shadow-lg",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {items.map((item, idx) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              tabIndex={idx === activeIdx ? 0 : -1}
              onClick={() => select(item)}
              onMouseEnter={() => setActiveIdx(idx)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm cursor-pointer",
                "text-text hover:bg-bg focus-visible:bg-bg focus-visible:outline-none",
                "disabled:opacity-40 disabled:cursor-default"
              )}
            >
              {item.icon && <span aria-hidden="true" className="text-text-muted">{item.icon}</span>}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

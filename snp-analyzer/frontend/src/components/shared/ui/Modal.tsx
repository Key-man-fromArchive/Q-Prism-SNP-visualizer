import { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./IconButton";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Max width class (default max-w-md). */
  widthClassName?: string;
  /** Hide the header close (X) button. */
  hideClose?: boolean;
  /** Optional aria role override (e.g. "alertdialog" for destructive confirms). */
  role?: "dialog" | "alertdialog";
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog (PRD NFR-DS-5): role=dialog + aria-modal, labelled by
 * title + described by description, initial focus into the dialog, focus trap,
 * Escape to close, background scroll lock, and focus restored to the invoking
 * element on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  widthClassName = "max-w-md",
  hideClose,
  role = "dialog",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    // Initial focus: first focusable inside the dialog, else the dialog itself.
    const node = dialogRef.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full rounded-lg border border-border bg-surface shadow-xl outline-none",
          widthClassName
        )}
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-text">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-xs text-text-muted">
                {description}
              </p>
            )}
          </div>
          {!hideClose && (
            <IconButton size="sm" aria-label="Close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          )}
        </div>
        {children && <div className="px-4 py-3">{children}</div>}
        {footer && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">{footer}</div>
        )}
      </div>
    </div>
  );
}

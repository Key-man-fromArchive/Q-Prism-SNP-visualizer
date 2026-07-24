import { Loader2, Inbox, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export type StatusVariant = "loading" | "empty" | "error";

export type StatusStateProps = {
  variant: StatusVariant;
  /** Primary message. */
  message: string;
  /** Optional secondary line (e.g. error detail). */
  detail?: string;
  /** Optional action (e.g. "분석 실행" for empty, "재시도" for error). */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/**
 * Consistent loading / empty / error placeholder so data panels never render a
 * blank void (PRD FR-ST-1/ST-2, P4). Fills its container and centers content.
 */
export function StatusState({ variant, message, detail, action, className }: StatusStateProps) {
  const Icon = variant === "loading" ? Loader2 : variant === "empty" ? Inbox : AlertCircle;
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "loading" ? "polite" : undefined}
      aria-busy={variant === "loading" || undefined}
      className={cn(
        "flex h-full min-h-[160px] w-full flex-col items-center justify-center gap-2 p-6 text-center",
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "h-7 w-7",
          variant === "loading" && "animate-spin text-primary",
          variant === "empty" && "text-text-muted",
          variant === "error" && "text-danger"
        )}
      />
      <p className={cn("text-sm", variant === "error" ? "text-danger" : "text-text-muted")}>
        {message}
      </p>
      {detail && <p className="text-xs text-text-muted max-w-md break-words">{detail}</p>}
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick} className="mt-1">
          {action.label}
        </Button>
      )}
    </div>
  );
}

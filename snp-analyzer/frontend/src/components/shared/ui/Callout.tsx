import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalloutTone = "info" | "success" | "warning" | "danger";

const TONES: Record<CalloutTone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "bg-primary/10 border-primary/30 text-text", Icon: Info },
  success: { cls: "bg-accent/10 border-accent/30 text-text", Icon: CheckCircle2 },
  warning: { cls: "bg-warning/10 border-warning/30 text-text", Icon: AlertTriangle },
  danger: { cls: "bg-danger/10 border-danger/30 text-text", Icon: XCircle },
};

export type CalloutProps = {
  tone?: CalloutTone;
  children: React.ReactNode;
  /** Optional trailing actions (e.g. CTA + dismiss). */
  actions?: React.ReactNode;
  className?: string;
  icon?: boolean;
};

/** Non-blocking inline banner/notice (PRD FR-NAV-4), token-based and theme-safe. */
export function Callout({ tone = "info", children, actions, className, icon = true }: CalloutProps) {
  const { cls, Icon } = TONES[tone];
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5 text-sm",
        cls,
        className
      )}
    >
      {icon && <Icon size={16} aria-hidden="true" className="shrink-0" />}
      <span className="flex-1 min-w-[200px]">{children}</span>
      {actions}
    </div>
  );
}

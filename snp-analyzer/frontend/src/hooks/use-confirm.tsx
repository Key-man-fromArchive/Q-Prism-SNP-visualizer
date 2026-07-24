import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/shared/ui";
import { useI18n } from "@/hooks/use-i18n";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

/**
 * Promise-based confirmation to replace window.confirm (PRD FR-CN-1). Returns a
 * `confirm(opts)` that resolves true/false, plus `confirmDialog` JSX to render
 * once in the component tree.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title, message, danger: true }))) return;
 *   return (<>...{confirmDialog}</>);
 */
export function useConfirm() {
  const { t } = useI18n();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={opts !== null}
      title={opts?.title ?? ""}
      message={opts?.message ?? ""}
      confirmLabel={opts?.confirmLabel ?? t.delete}
      cancelLabel={opts?.cancelLabel ?? t.cancel}
      danger={opts?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}

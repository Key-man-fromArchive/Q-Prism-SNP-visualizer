import { useEffect, useRef } from 'react';
import { FileStack } from 'lucide-react';
import { useFileWorkspaceStore, type FileWorkspacePlacement } from '@/stores/file-workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useI18n } from '@/hooks/use-i18n';

type FileWorkspaceTriggerProps = {
  placement: FileWorkspacePlacement;
  className?: string;
};

const HEADER_CLASSNAME =
  'relative inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text hover:border-primary hover:text-primary';
const INLINE_CLASSNAME =
  'relative inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-muted hover:border-primary hover:text-primary';

/** Opens the always-mounted `FileWorkspaceDrawer` panel. Rendered in two
 *  mutually-exclusive places (App.tsx picks which via `visibility.upload`):
 *  the header (once a session is open) or inline next to `UploadZone`'s drop
 *  area (before any session exists). Both read/write the same shared store,
 *  so whichever is on screen shows the same queue and open state. */
export function FileWorkspaceTrigger({ placement, className }: FileWorkspaceTriggerProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);
  const open = useFileWorkspaceStore((s) => s.open);
  const setOpen = useFileWorkspaceStore((s) => s.setOpen);
  const registerTrigger = useFileWorkspaceStore((s) => s.registerTrigger);
  const openSessionCount = useSessionStore((s) => s.openSessionIds.length);

  useEffect(() => {
    registerTrigger(placement, ref.current);
    return () => registerTrigger(placement, null);
  }, [placement, registerTrigger]);

  const label = placement === 'inline' ? t.workspaceManageFiles : t.workspaceFiles;

  return (
    <button
      ref={ref}
      type="button"
      id="file-workspace-button"
      data-testid={`file-workspace-trigger-${placement}`}
      onClick={() => setOpen(true)}
      className={className ?? (placement === 'inline' ? INLINE_CLASSNAME : HEADER_CLASSNAME)}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <FileStack size={14} aria-hidden="true" />
      {label}
      {openSessionCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[10px] leading-4 text-white">
          {openSessionCount}
        </span>
      )}
    </button>
  );
}

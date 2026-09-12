import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import {
  getSessions,
  previewImportFile,
  uploadFile,
} from '@/lib/api';
import { useI18n } from '@/hooks/use-i18n';
import { useSessionStore } from '@/stores/session-store';
import { useFileWorkspaceStore } from '@/stores/file-workspace-store';
import { MAX_FILES_PER_DROP, MAX_TOTAL_MB, uploadLimitViolation } from '@/lib/upload-jobs';
import type {
  ImportPreview,
  SessionListItem,
  UploadResponse,
  ValidationIssue,
} from '@/types/api';
import { ImportMappingWizard } from './ImportMappingWizard';

const RAW_EXTENSIONS = ['.eds', '.xls', '.xlsx', '.pcrd', '.zip'];
const MAPPED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.rdml', '.rdm'];
const ACCEPTED_EXTENSIONS = [...RAW_EXTENSIONS, '.xml', ...MAPPED_EXTENSIONS].join(',');
const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

type QueueStatus = 'queued' | 'packaging' | 'uploading' | 'mapping' | 'success' | 'error';

type QueueItem = {
  id: string;
  file: File;
  status: QueueStatus;
  error?: string;
  sessionId?: string;
  preview?: ImportPreview;
  previewIssues?: ValidationIssue[];
};

type FileWorkspaceDrawerProps = {
  onOpenSession?: () => void;
  onGoToProject?: () => void;
};

function extensionOf(file: File): string {
  const index = file.name.lastIndexOf('.');
  return index >= 0 ? file.name.slice(index).toLowerCase() : '';
}

function queueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isValidationResponse(value: unknown): value is { status: 'validation_failed'; issues: ValidationIssue[] } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'status' in value &&
      value.status === 'validation_failed' &&
      'issues' in value,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileWorkspaceDrawer({ onOpenSession, onGoToProject }: FileWorkspaceDrawerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const sessionListRevisionRef = useRef(0);
  // `open` (and which trigger to return focus to on close) is shared state:
  // this panel is mounted once, permanently, at the App root, while the
  // trigger that opens/closes it renders in one of two places depending on
  // whether a session is active. See file-workspace-store.ts.
  const open = useFileWorkspaceStore((s) => s.open);
  const setOpen = useFileWorkspaceStore((s) => s.setOpen);
  const focusVisibleTrigger = useFileWorkspaceStore((s) => s.focusVisibleTrigger);
  const [dragover, setDragover] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const activeSessionId = useSessionStore((s) => s.sessionId);
  const activeSessionInfo = useSessionStore((s) => s.sessionInfo);
  const openSessionIds = useSessionStore((s) => s.openSessionIds);
  const loadSession = useSessionStore((s) => s.loadSession);
  const addOpenSession = useSessionStore((s) => s.addOpenSession);
  const closeOpenSession = useSessionStore((s) => s.closeOpenSession);
  const syncOpenSessions = useSessionStore((s) => s.syncOpenSessions);
  const resetSession = useSessionStore((s) => s.reset);

  const refreshSessions = useCallback(async () => {
    const revision = ++sessionListRevisionRef.current;
    setLoadingSessions(true);
    setListError(null);
    try {
      const result = await getSessions();
      if (revision !== sessionListRevisionRef.current) return;
      setSessions(result);
      syncOpenSessions(result.map((session) => session.session_id));
    } catch (error) {
      if (revision !== sessionListRevisionRef.current) return;
      setListError(error instanceof Error ? error.message : t.errLoadSessions);
    } finally {
      if (revision === sessionListRevisionRef.current) setLoadingSessions(false);
    }
  }, [syncOpenSessions, t.errLoadSessions]);

  useEffect(() => {
    if (!open) return;
    void refreshSessions();
  }, [open, refreshSessions]);

  useEffect(() => {
    const handleRefresh = () => void refreshSessions();
    window.addEventListener('sessions-changed', handleRefresh);
    return () => window.removeEventListener('sessions-changed', handleRefresh);
  }, [refreshSessions]);

  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      // Whichever trigger is on screen *now* gets focus back — not
      // necessarily the one that opened this: a session can be created
      // while the panel stays open, silently swapping the visible trigger
      // from inline (near the drop zone) to the header, and back is never
      // taken away from the operator.
      focusVisibleTrigger();
    };
  }, [open, setOpen, focusVisibleTrigger]);

  const updateQueue = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const registerUploadedSession = useCallback(
    (info: UploadResponse) => {
      addOpenSession(info.session_id);
      window.dispatchEvent(new CustomEvent('sessions-changed'));
    },
    [addOpenSession],
  );

  const processQueueItem = useCallback(
    async (item: QueueItem) => {
      const ext = extensionOf(item.file);
      updateQueue(item.id, { status: 'uploading', error: undefined });
      try {
        if (MAPPED_EXTENSIONS.includes(ext)) {
          const preview = await previewImportFile(item.file);
          if (isValidationResponse(preview)) {
            updateQueue(item.id, {
              status: 'error',
              error: preview.issues.map((issue) => issue.message).join('; '),
              previewIssues: preview.issues,
            });
          } else {
            updateQueue(item.id, { status: 'mapping', preview, previewIssues: [] });
          }
          return;
        }

        try {
          const info = await uploadFile(item.file);
          registerUploadedSession(info);
          updateQueue(item.id, { status: 'success', sessionId: info.session_id });
        } catch (error) {
          if (ext === '.xlsx') {
            const preview = await previewImportFile(item.file);
            if (!isValidationResponse(preview)) {
              updateQueue(item.id, { status: 'mapping', preview, previewIssues: [] });
              return;
            }
          }
          throw error;
        }
      } catch (error) {
        updateQueue(item.id, {
          status: 'error',
          error: error instanceof Error ? error.message : t.uploadFailed,
        });
      }
    },
    [registerUploadedSession, t.uploadFailed, updateQueue],
  );

  const scheduleQueueItem = useCallback(
    (item: QueueItem) => {
      uploadChainRef.current = uploadChainRef.current.then(() => processQueueItem(item));
      return uploadChainRef.current;
    },
    [processQueueItem],
  );

  const enqueueFiles = useCallback(
    async (files: File[]) => {
      const supportedWithDuplicates = files.filter((file) =>
        [...RAW_EXTENSIONS, '.xml', ...MAPPED_EXTENSIONS].includes(extensionOf(file)),
      );
      const seen = new Set<string>();
      const supported = supportedWithDuplicates.filter((file) => {
        const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (supported.length === 0) {
        setListError(t.noSupportedFilesDetail);
        return;
      }
      // Shared with UploadZone's central drop path (P5-S2-T1): same numbers,
      // same message, from lib/upload-jobs.ts — this drawer still keeps its
      // own queue/state-machine implementation (D-7, not unified).
      const violation = uploadLimitViolation(supported);
      if (violation === 'too_many_files') {
        setListError(t.workspaceTooManyFiles(MAX_FILES_PER_DROP));
        return;
      }
      if (violation === 'total_too_large') {
        setListError(t.workspaceTotalTooLarge(MAX_TOTAL_MB));
        return;
      }

      setListError(null);
      const xmlFiles = supported.filter((file) => extensionOf(file) === '.xml');
      const directFiles = supported.filter((file) => extensionOf(file) !== '.xml');
      const items: QueueItem[] = directFiles.map((file) => ({
        id: queueId(),
        file,
        status: 'queued',
      }));

      if (xmlFiles.length > 0) {
        const placeholder: QueueItem = {
          id: queueId(),
          file: new File([], 'cfx_xml_export.zip', { type: 'application/zip' }),
          status: 'packaging',
        };
        items.push(placeholder);
        setQueue((current) => [...current, ...items]);
        try {
          const zip = new JSZip();
          for (const file of xmlFiles) zip.file(file.name, await file.arrayBuffer());
          const blob = await zip.generateAsync({ type: 'blob' });
          placeholder.file = new File([blob], 'cfx_xml_export.zip', { type: 'application/zip' });
          placeholder.status = 'queued';
          updateQueue(placeholder.id, { file: placeholder.file, status: 'queued' });
        } catch (error) {
          placeholder.status = 'error';
          updateQueue(placeholder.id, {
            status: 'error',
            error: error instanceof Error ? error.message : t.packagingFailed,
          });
        }
      } else {
        setQueue((current) => [...current, ...items]);
      }

      for (const item of items) {
        if (item.status !== 'error') void scheduleQueueItem(item);
      }
    },
    [scheduleQueueItem, t, updateQueue],
  );

  const handleOpenSession = useCallback(
    async (sid: string) => {
      setListError(null);
      try {
        const loaded = await loadSession(sid);
        if (!loaded) return;
        onOpenSession?.();
        setOpen(false);
      } catch (error) {
        setListError(error instanceof Error ? error.message : t.errLoadSession);
      }
    },
    [loadSession, onOpenSession, setOpen, t.errLoadSession],
  );

  const handleCloseSession = useCallback(
    async (sid: string) => {
      const remaining = openSessionIds.filter((id) => id !== sid);
      closeOpenSession(sid);
      if (activeSessionId !== sid) return;
      if (remaining.length > 0) {
        try {
          await loadSession(remaining[0]);
          onOpenSession?.();
        } catch (error) {
          setListError(error instanceof Error ? error.message : t.errLoadSession);
          resetSession();
        }
      } else {
        resetSession();
      }
    },
    [activeSessionId, closeOpenSession, loadSession, onOpenSession, openSessionIds, resetSession, t.errLoadSession],
  );

  const openSessions = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.session_id, session]));
    if (activeSessionId && activeSessionInfo && !byId.has(activeSessionId)) {
      byId.set(activeSessionId, {
        session_id: activeSessionId,
        raw_filename: activeSessionInfo.raw_filename,
        instrument: activeSessionInfo.instrument,
        num_wells: activeSessionInfo.num_wells,
        num_cycles: activeSessionInfo.num_cycles,
        uploaded_at: '',
      });
    }
    return openSessionIds.flatMap((id) => {
      const session = byId.get(id);
      return session ? [session] : [];
    });
  }, [activeSessionId, activeSessionInfo, openSessionIds, sessions]);

  const openSet = useMemo(() => new Set(openSessionIds), [openSessionIds]);
  const recentSessions = sessions.filter((session) => !openSet.has(session.session_id)).slice(0, 8);
  const activeMapping = queue.find((item) => item.status === 'mapping' && item.preview);
  const busyCount = queue.filter((item) => ['queued', 'packaging', 'uploading'].includes(item.status)).length;

  // This panel owns the queue/session-list state and is mounted exactly
  // once, permanently, at the App root (see App.tsx) — never conditionally,
  // so an in-flight upload queue can never be torn down by a session
  // appearing mid-upload and flipping which FileWorkspaceTrigger is visible.
  // It renders nothing itself (not even a trigger button) when closed, and
  // portals its dialog to <body> so it never depends on being mounted near
  // whichever trigger opened it.
  if (!open) return null;
  return createPortal(
    (
      <div className="fixed inset-0 z-[120]" role="presentation">
        <button
          type="button"
          className="absolute inset-0 cursor-default bg-black/40"
          aria-label={t.close}
          onClick={() => setOpen(false)}
        />
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={t.workspaceTitle}
          className="absolute inset-y-0 right-0 flex w-full max-w-[720px] flex-col border-l border-border bg-bg shadow-2xl"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const nodes = drawerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
            if (!nodes?.length) return;
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="flex items-start justify-between border-b border-border bg-surface px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-text">{t.workspaceTitle}</h2>
              <p className="mt-0.5 text-xs text-text-muted">{t.workspaceDescription}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="text-text-muted hover:text-text">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div
              className={`rounded-lg border-2 border-dashed p-5 text-center transition-colors ${
                dragover ? 'border-primary bg-primary/10' : 'border-border bg-surface'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragover(true);
              }}
              onDragLeave={() => setDragover(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragover(false);
                const entries = Array.from(event.dataTransfer.items ?? [])
                  .map((item) => item.webkitGetAsEntry?.())
                  .filter((entry): entry is FileSystemEntry => Boolean(entry));
                if (entries.some((entry) => entry.isDirectory)) {
                  void readDroppedEntries(entries).then(enqueueFiles);
                } else {
                  void enqueueFiles(Array.from(event.dataTransfer.files));
                }
              }}
            >
              <Upload className="mx-auto mb-2 text-primary" size={26} aria-hidden="true" />
              <p className="text-sm font-medium text-text">{t.workspaceDropTitle}</p>
              <p className="mt-1 text-xs text-text-muted">{t.workspaceDropHint(MAX_FILES_PER_DROP)}</p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-on-primary hover:bg-primary-hover"
                >
                  {t.browseFiles}
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="rounded-md border border-primary px-4 py-2 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  {t.browseFolder}
                </button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files?.length) void enqueueFiles(Array.from(event.target.files));
                  event.target.value = '';
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                hidden
                // @ts-expect-error webkitdirectory is supported by Chromium-based browsers.
                webkitdirectory=""
                onChange={(event) => {
                  if (event.target.files?.length) void enqueueFiles(Array.from(event.target.files));
                  event.target.value = '';
                }}
              />
            </div>

            {listError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{listError}</span>
              </div>
            )}

            {queue.length > 0 && (
              <section className="mt-5" aria-label={t.workspaceUploadQueue} aria-live="polite">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text">{t.workspaceUploadQueue}</h3>
                  <button type="button" onClick={() => setQueue((items) => items.filter((item) => !['success', 'error'].includes(item.status)))} className="text-xs text-text-muted hover:text-text">
                    {t.workspaceClearFinished}
                  </button>
                </div>
                <div className="space-y-2">
                  {queue.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
                      {item.status === 'success' ? (
                        <CheckCircle2 size={16} className="shrink-0 text-success" />
                      ) : item.status === 'error' ? (
                        <AlertCircle size={16} className="shrink-0 text-danger" />
                      ) : ['uploading', 'packaging'].includes(item.status) ? (
                        <LoaderCircle size={16} className="shrink-0 animate-spin text-primary" />
                      ) : (
                        <FolderOpen size={16} className="shrink-0 text-text-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-text">{item.file.name}</p>
                        <p className={`truncate text-[11px] ${item.status === 'error' ? 'text-danger' : 'text-text-muted'}`} title={item.error}>
                          {item.error || t.workspaceQueueStatus(item.status, formatBytes(item.file.size))}
                        </p>
                      </div>
                      {item.status === 'error' && (
                        <button type="button" onClick={() => void scheduleQueueItem(item)} className="inline-flex items-center gap-1 text-xs text-primary">
                          <RefreshCw size={12} /> {t.retry}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeMapping?.preview && (
              <ImportMappingWizard
                file={activeMapping.file}
                preview={activeMapping.preview}
                previewIssues={activeMapping.previewIssues ?? []}
                previewing={false}
                onPreviewAgain={async () => {
                  await scheduleQueueItem(activeMapping);
                }}
                onCancel={async () => {
                  updateQueue(activeMapping.id, { status: 'error', error: t.workspaceMappingCancelled });
                }}
                onImported={(info) => {
                  registerUploadedSession(info);
                  updateQueue(activeMapping.id, { status: 'success', sessionId: info.session_id });
                }}
              />
            )}

            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">{t.workspaceOpenFiles}</h3>
                {loadingSessions && <LoaderCircle size={14} className="animate-spin text-text-muted" />}
              </div>
              {openSessions.length === 0 ? (
                <p className="rounded-md border border-border bg-surface p-4 text-center text-xs text-text-muted">{t.workspaceNoOpenFiles}</p>
              ) : (
                <div className="space-y-2">
                  {openSessions.map((session) => (
                    <SessionRow
                      key={session.session_id}
                      session={session}
                      active={session.session_id === activeSessionId}
                      onOpen={() => void handleOpenSession(session.session_id)}
                      onClose={() => void handleCloseSession(session.session_id)}
                      activeLabel={t.active}
                      openLabel={t.workspaceOpen}
                      closeLabel={t.workspaceCloseFile}
                      wellsLabel={t.wells}
                      cyclesLabel={t.cycles}
                    />
                  ))}
                </div>
              )}
            </section>

            {recentSessions.length > 0 && (
              <section className="mt-6">
                <h3 className="mb-2 text-sm font-semibold text-text">{t.workspaceRecentFiles}</h3>
                <div className="space-y-2">
                  {recentSessions.map((session) => (
                    <SessionRow
                      key={session.session_id}
                      session={session}
                      active={false}
                      onOpen={() => {
                        addOpenSession(session.session_id);
                        void handleOpenSession(session.session_id);
                      }}
                      activeLabel={t.active}
                      openLabel={t.workspaceOpen}
                      wellsLabel={t.wells}
                      cyclesLabel={t.cycles}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {busyCount > 0 && (
            <div className="border-t border-border bg-surface px-5 py-3 text-xs text-text-muted">
              {t.workspaceUploadingCount(busyCount)}
            </div>
          )}
          {busyCount === 0 && onGoToProject && (
            <div className="border-t border-border bg-surface px-5 py-3 text-right">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onGoToProject();
                }}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                {t.workspaceManageProjects}
              </button>
            </div>
          )}
        </aside>
      </div>
    ),
    document.body,
  );
}

type SessionRowProps = {
  session: SessionListItem;
  active: boolean;
  onOpen: () => void;
  onClose?: () => void;
  activeLabel: string;
  openLabel: string;
  closeLabel?: string;
  wellsLabel: string;
  cyclesLabel: string;
};

function SessionRow({
  session,
  active,
  onOpen,
  onClose,
  activeLabel,
  openLabel,
  closeLabel,
  wellsLabel,
  cyclesLabel,
}: SessionRowProps) {
  return (
    <div className={`flex items-center gap-3 rounded-md border px-3 py-2 ${active ? 'border-primary bg-primary/5' : 'border-border bg-surface'}`}>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-text">{session.raw_filename || session.session_id}</span>
          {active && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{activeLabel}</span>}
        </span>
        <span className="mt-0.5 block text-[11px] text-text-muted">
          {session.instrument} · {session.num_wells} {wellsLabel} · {session.num_cycles} {cyclesLabel}
        </span>
      </button>
      {!active && <button type="button" onClick={onOpen} className="text-xs font-medium text-primary">{openLabel}</button>}
      {onClose && (
        <button type="button" onClick={onClose} title={closeLabel} aria-label={closeLabel} className="text-text-muted hover:text-danger">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

async function readDroppedEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];

  const readEntry = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      await new Promise<void>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(
          (file) => {
            files.push(file);
            resolve();
          },
          reject,
        );
      });
      return;
    }

    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = [];
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        children.push(...batch);
      }
      await Promise.all(children.map(readEntry));
    }
  };

  await Promise.all(entries.map(readEntry));
  return files;
}

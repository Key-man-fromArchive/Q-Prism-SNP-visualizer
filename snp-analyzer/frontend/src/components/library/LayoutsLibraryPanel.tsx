// @TASK feat/library-hub - Library tab "레이아웃" sub-surface: full
// browse/manage UI for the per-user saved-layout library (moved out of the
// Plate Setup surface, which now only keeps the CONTEXTUAL quick actions --
// "현재 배치 저장" and "레이아웃 적용" -- that operate on the currently open
// plate). This panel is the single place to browse every saved layout,
// copy/delete them, and -- when a session is open -- load any one of them
// onto the current plate or snapshot the current plate as a new layout.
// @SPEC docs/multi-marker-ux-decision.md §3.5 (per-user layout library)
// @TEST e2e/p4-s3-layout.spec.ts

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { listLayouts, saveLayout, deleteLayout, copyLayout } from "@/lib/api";
import type { SavedLayout } from "@/types/api";
import { useAuthStore } from '@/stores/auth-store';
import { Modal } from '@/components/shared/ui/Modal';
import { useLayoutApply } from './use-layout-apply';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { useConfirm } from '@/hooks/use-confirm';
import { validLayoutList } from '@/lib/management-payload';

export function LayoutsLibraryPanel() {
  const generation = useAuthStore(s => s.generation);
  const entry = useSessionStore(s => s.entryGeneration);
  const sid = useSessionStore(s => s.sessionId);
  return <LayoutsWorkspace key={`${generation}:${entry}:${sid}`} />;
}

function LayoutsWorkspace() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);
  const readOwner = useOwnedOperation();
  const mutationOwner = useOwnedOperation();
  const confirmationOwner = useOwnedOperation();
  const { confirm: confirmDelete, confirmDialog } = useConfirm();

  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { applyingId, conflict, load, confirm, cancel } = useLayoutApply(sessionId, () => setError(t.libraryActionFailed));

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useMemo(
    () => async (afterChange = false) => {
      const ticket = readOwner.begin();
      setLoading(true);
      setError(null);
      try {
      const res = await listLayouts();
      if (!readOwner.current(ticket)) return;
      if (!validLayoutList(res)) throw new Error('Invalid layout response');
      setLayouts(res.layouts);
      } catch {
        if (readOwner.current(ticket)) setError(afterChange ? t.libraryRefreshFailed : t.statusLoadFailed);
      } finally {
        if (readOwner.current(ticket)) setLoading(false);
      }
    },
    [readOwner, t]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCopy(layout: SavedLayout) {
    const ticket = mutationOwner.begin();
    setError(null);
    try {
      await copyLayout(layout.id);
      if (mutationOwner.current(ticket)) await refresh(true);
    } catch {
      if (mutationOwner.current(ticket)) setError(t.libraryActionFailed);
    }
  }

  async function handleDelete(layout: SavedLayout) {
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirmDelete({ title: t.delete, message: t.layoutDeleteConfirm(layout.name), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = mutationOwner.begin();
    if (!mutationOwner.current(ticket)) return;
    setError(null);
    try {
      await deleteLayout(layout.id);
      if (!mutationOwner.current(ticket)) return;
      setLayouts((prev) => prev.filter((l) => l.id !== layout.id));
      if (conflict?.layout.id === layout.id) cancel();
    } catch {
      if (mutationOwner.current(ticket)) setError(t.libraryActionFailed);
    }
  }

  function openSaveForm() {
    setError(null);
    setSaveName("");
    setShowSaveForm(true);
  }

  function cancelSaveForm() {
    setShowSaveForm(false);
    setSaveName("");
  }

  async function confirmSave() {
    const name = saveName.trim();
    if (!name || !sessionId) return;
    const ticket = mutationOwner.begin();
    setSaving(true);
    setError(null);
    try {
      await saveLayout(name, sessionId);
      if (!mutationOwner.current(ticket)) return;
      setShowSaveForm(false);
      setSaveName("");
      await refresh(true);
      // PlateSetupTab's own "레이아웃 적용" quick action reads its cached
      // layout list to find the most-recently-saved one -- keep it fresh
      // even though the save happened from this (Library) surface.
      if (mutationOwner.current(ticket)) window.dispatchEvent(new CustomEvent("layouts-changed"));
    } catch {
      if (mutationOwner.current(ticket)) setError(t.libraryActionFailed);
    } finally {
      if (mutationOwner.current(ticket)) setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl min-w-0">
      {confirmDialog}
      <div className="panel mb-4">
        <h2 className="text-lg font-semibold text-text mb-1">{t.wsLayoutLibraryTitle}</h2>

        {!sessionId && (
          <p
            data-testid="library-layouts-no-session-hint"
            className="mt-2 px-3 py-2 rounded-md text-sm text-text-muted bg-bg border border-border"
          >
            {t.libNoSessionHint}
          </p>
        )}

        {error && (
          <div role="alert" className="mt-3 px-3 py-2 rounded-md text-sm text-danger bg-danger/10">{error} <button type="button" onClick={() => void refresh()}>{t.retry}</button></div>
        )}
      </div>

      <div className="panel">
        {loading ? (
          <p role="status" className="text-sm text-text-muted py-6 text-center">{t.loading}</p>
        ) : layouts.length === 0 && !error ? (
          <p className="text-sm text-text-muted py-6 text-center whitespace-pre-line">
            {t.wsLayoutEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {layouts.map((l) => (
              <div key={l.id}>
                <div
                  data-testid="layout-row"
                  className="flex flex-wrap items-center gap-2 border border-border bg-bg rounded-md p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div title={l.name} className="font-semibold text-sm text-text break-words">{l.name}</div>
                    <div className="text-xs text-text-muted font-mono mt-0.5">
                      {t.wsLayoutMeta(
                        l.snapshot.markers.length,
                        l.snapshot.markers.reduce((sum, m) => sum + m.wells.length, 0)
                      )}
                    </div>
                  </div>
                  <div className="flex-none flex flex-wrap gap-2">
                    {sessionId && (
                      <button
                        type="button"
                        data-testid="layout-load-button"
                        disabled={applyingId !== null}
                        onClick={() => load(l)}
                        className="border border-primary text-primary rounded-md px-2.5 py-1 text-xs font-semibold hover:bg-primary hover:text-on-primary disabled:opacity-40 cursor-pointer"
                      >
                        {t.libLoadOntoCurrentButton}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="layout-copy-button"
                      onClick={() => handleCopy(l)}
                      className="text-text-muted hover:text-text text-xs font-medium cursor-pointer"
                    >
                      {t.mcatCopyButton}
                    </button>
                    <button
                      type="button"
                      data-testid="layout-delete-button"
                      aria-label={t.delete}
                      title={t.delete}
                      onClick={() => handleDelete(l)}
                      className="w-6 h-6 grid place-items-center rounded-md text-text-muted hover:text-danger hover:bg-bg cursor-pointer"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {conflict?.layout.id === l.id && (
                  <Modal open onClose={cancel} title={t.wsLayoutPloidyConflictTitle} closeLabel={t.close} role="alertdialog">
                  <div
                    data-testid="layout-load-conflict-dialog"
                    className="mt-1 px-2.5 py-2 rounded-md text-xs border"
                    style={{ background: "rgba(217,119,6,0.12)", borderColor: "rgba(217,119,6,0.35)" }}
                  >
                    <p className="font-semibold text-text mb-1">{t.wsLayoutPloidyConflictTitle}</p>
                    <p className="text-text-muted mb-2">
                      {t.wsLayoutPloidyConflictBody(conflict.ids.join(", "))}
                    </p>
                    <div className="flex gap-1.5 justify-end">
                      <button
                        type="button"
                        data-testid="layout-load-conflict-cancel"
                        onClick={cancel}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-bg text-text-muted cursor-pointer"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        data-testid="layout-load-conflict-confirm"
                        disabled={applyingId !== null}
                        onClick={confirm}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-danger text-white cursor-pointer"
                      >
                        {t.wsLayoutForceApplyButton}
                      </button>
                    </div>
                  </div>
                  </Modal>
                )}
              </div>
            ))}
          </div>
        )}

        {sessionId && (
          <div className="mt-3 pt-3 border-t border-border">
            {showSaveForm ? (
              <div className="flex gap-1.5">
                <input
                  data-testid="library-layout-save-name-input"
                  aria-label={t.wsLayoutSaveNamePlaceholder}
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirmSave();
                    if (e.key === "Escape") cancelSaveForm();
                  }}
                  placeholder={t.wsLayoutSaveNamePlaceholder}
                  className="flex-1 min-w-0 border border-primary rounded-md px-2 py-1.5 text-xs bg-surface text-text"
                />
                <button
                  type="button"
                  data-testid="library-layout-save-confirm"
                  disabled={saving || !saveName.trim()}
                  onClick={confirmSave}
                  className="flex-none rounded-md px-3 py-1.5 text-xs font-semibold bg-primary text-on-primary disabled:opacity-40 cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  type="button"
                  data-testid="library-layout-save-cancel"
                  onClick={cancelSaveForm}
                  className="flex-none rounded-md px-2.5 py-1.5 text-xs font-medium text-text-muted cursor-pointer"
                >
                  {t.cancel}
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="library-layout-save-open"
                onClick={openSaveForm}
                className="w-full border border-dashed border-border rounded-md py-2 text-xs font-medium text-text-muted hover:text-primary hover:border-primary cursor-pointer"
              >
                {t.wsLayoutSaveOpenButton}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

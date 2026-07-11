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
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { listLayouts, saveLayout, deleteLayout, copyLayout, applyLayout, ApiError } from "@/lib/api";
import type { SavedLayout, LayoutApplyConflict } from "@/types/api";
import { extractLayoutConflict, extractLayoutMissingWellsMessage } from "@/lib/layout-conflict";

export function LayoutsLibraryPanel() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);

  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    layoutId: string;
    layoutName: string;
    conflict: LayoutApplyConflict;
  } | null>(null);

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await listLayouts();
        setLayouts(res.layouts);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCopy(layout: SavedLayout) {
    setError(null);
    try {
      await copyLayout(layout.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(layout: SavedLayout) {
    setError(null);
    try {
      await deleteLayout(layout.id);
      setLayouts((prev) => prev.filter((l) => l.id !== layout.id));
      if (conflict?.layoutId === layout.id) setConflict(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Loads a saved layout onto the CURRENT session's plate. Never blind --
   * a 409 (ploidy conflict, L2) stops here and requires an explicit
   * second confirmation via `confirmConflictForce`, mirroring the same
   * `/api/layouts/{id}/apply` contract the Plate Setup surface's own
   * "레이아웃 적용" quick action uses. */
  async function handleLoad(layout: SavedLayout, force: boolean) {
    if (!sessionId) return;
    setError(null);
    setApplyingId(layout.id);
    try {
      await applyLayout(layout.id, { sid: sessionId, force });
      setConflict(null);
      // Neither AnalysisWorkspace nor PlateSetupTab re-fetch their own
      // (locally-held) marker/well-type state on a top-level tab switch --
      // only on session change or plate/analysis surface toggles -- so a
      // Library-triggered apply must announce itself explicitly.
      window.dispatchEvent(new CustomEvent("markers-changed"));
      window.dispatchEvent(new CustomEvent("welltypes-changed"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const c = extractLayoutConflict(err);
        if (c) {
          setConflict({ layoutId: layout.id, layoutName: layout.name, conflict: c });
          return;
        }
      }
      if (err instanceof ApiError && err.status === 400) {
        setError(extractLayoutMissingWellsMessage(err));
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }

  function cancelConflict() {
    setConflict(null);
  }

  async function confirmConflictForce() {
    if (!conflict) return;
    const layout = layouts.find((l) => l.id === conflict.layoutId);
    if (!layout) {
      setConflict(null);
      return;
    }
    await handleLoad(layout, true);
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
    setSaving(true);
    setError(null);
    try {
      await saveLayout(name, sessionId);
      setShowSaveForm(false);
      setSaveName("");
      await refresh();
      // PlateSetupTab's own "레이아웃 적용" quick action reads its cached
      // layout list to find the most-recently-saved one -- keep it fresh
      // even though the save happened from this (Library) surface.
      window.dispatchEvent(new CustomEvent("layouts-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl">
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
          <div className="mt-3 px-3 py-2 rounded-md text-sm text-danger bg-danger/10">{error}</div>
        )}
      </div>

      <div className="panel">
        {loading ? (
          <p className="text-sm text-text-muted py-6 text-center">{t.loading}</p>
        ) : layouts.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center whitespace-pre-line">
            {t.wsLayoutEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {layouts.map((l) => (
              <div key={l.id}>
                <div
                  data-testid="layout-row"
                  className="flex items-center gap-2 border border-border bg-bg rounded-md p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-text truncate">{l.name}</div>
                    <div className="text-xs text-text-muted font-mono mt-0.5">
                      {t.wsLayoutMeta(
                        l.snapshot.markers.length,
                        l.snapshot.markers.reduce((sum, m) => sum + m.wells.length, 0)
                      )}
                    </div>
                  </div>
                  <div className="flex-none flex gap-2">
                    {sessionId && (
                      <button
                        type="button"
                        data-testid="layout-load-button"
                        disabled={applyingId === l.id}
                        onClick={() => handleLoad(l, false)}
                        className="border border-primary text-primary rounded-md px-2.5 py-1 text-xs font-semibold hover:bg-primary hover:text-white disabled:opacity-40 cursor-pointer"
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
                      ✕
                    </button>
                  </div>
                </div>

                {conflict?.layoutId === l.id && (
                  <div
                    data-testid="layout-load-conflict-dialog"
                    role="alertdialog"
                    aria-modal="true"
                    className="mt-1 px-2.5 py-2 rounded-md text-xs border"
                    style={{ background: "rgba(217,119,6,0.12)", borderColor: "rgba(217,119,6,0.35)" }}
                  >
                    <p className="font-semibold text-text mb-1">{t.wsLayoutPloidyConflictTitle}</p>
                    <p className="text-text-muted mb-2">
                      {t.wsLayoutPloidyConflictBody(conflict.conflict.conflicting_marker_ids.join(", "))}
                    </p>
                    <div className="flex gap-1.5 justify-end">
                      <button
                        type="button"
                        data-testid="layout-load-conflict-cancel"
                        onClick={cancelConflict}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-bg text-text-muted cursor-pointer"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        data-testid="layout-load-conflict-confirm"
                        onClick={confirmConflictForce}
                        className="px-2.5 py-1 rounded-md text-xs font-semibold bg-danger text-white cursor-pointer"
                      >
                        {t.wsLayoutForceApplyButton}
                      </button>
                    </div>
                  </div>
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
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void confirmSave();
                  }}
                  placeholder={t.wsLayoutSaveNamePlaceholder}
                  className="flex-1 min-w-0 border border-primary rounded-md px-2 py-1.5 text-xs bg-surface text-text"
                />
                <button
                  type="button"
                  data-testid="library-layout-save-confirm"
                  disabled={saving || !saveName.trim()}
                  onClick={confirmSave}
                  className="flex-none rounded-md px-3 py-1.5 text-xs font-semibold bg-primary text-white disabled:opacity-40 cursor-pointer"
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

// @TASK P4-S1 - Plate Setup surface (marker definition + well assignment)
// @SPEC docs/multi-marker-ux-decision.md §3.5 (well select -> marker pick -> 배정)
// @TEST e2e/p4-s1-plate-setup.spec.ts

import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { useSessionStore } from "@/stores/session-store";
import { useDataStore } from "@/stores/data-store";
import {
  getMarkers,
  saveMarkers,
  getWellTypes,
  setWellTypes as apiSetWellTypes,
  listLayouts,
  saveLayout,
  applyLayout,
  listMarkerCatalog,
  attachMarkerCatalog,
  ApiError,
} from "@/lib/api";
import type { MarkerRegion, SavedLayout, LayoutApplyConflict, MarkerCatalogEntry } from "@/types/api";
import { WellType } from "@/types/api";
import { MARKER_PALETTE } from "@/lib/constants";
import { extractLayoutConflict, extractLayoutMissingWellsMessage } from "@/lib/layout-conflict";

const ROW_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PLOIDY_OPTIONS = [2, 3, 4, 5, 6, 7, 8];

function genMarkerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function PlateSetupTab() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);
  const setWellTypeAssignments = useDataStore((s) => s.setWellTypeAssignments);

  // Physical plate layout (96 = 8x12, 384 = 16x24) -- derived from the
  // session's own well count so this surface never has to wait on the
  // Analysis surface's cycle-scoped plate fetch.
  const { plateRows, plateCols } = useMemo(() => {
    const numWells = sessionInfo?.num_wells ?? 96;
    const isBig = numWells > 96;
    const rows = isBig ? 16 : 8;
    const cols = isBig ? 24 : 12;
    return {
      plateRows: ROW_ALPHABET.slice(0, rows).split(""),
      plateCols: Array.from({ length: cols }, (_, i) => i + 1),
    };
  }, [sessionInfo]);

  // Markers are local-first: a newly-created marker with zero wells is only
  // ever kept client-side (the backend rejects an empty-wells marker), and
  // is persisted the moment it receives >=1 well via 배정/unassign.
  const [markers, setMarkers] = useState<MarkerRegion[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selectedWells, setSelectedWells] = useState<string[]>([]);
  const [pickMarkerId, setPickMarkerId] = useState<string | null>(null);

  const [editingMarker, setEditingMarker] = useState<"new" | string | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string>(MARKER_PALETTE[0]);
  const [formPloidy, setFormPloidy] = useState<number>(2);
  // Attach-to-catalog (feat/marker-catalog): pick an existing catalog assay
  // to prefill name/ploidy/color from when creating/editing a marker.
  const [catalogEntries, setCatalogEntries] = useState<MarkerCatalogEntry[]>([]);
  const [formCatalogId, setFormCatalogId] = useState<string>("");

  // Layout library (P4-S3) -- per-USER, not per-session, so this list is
  // never cleared by the session-change reset below.
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [showLayoutSaveForm, setShowLayoutSaveForm] = useState(false);
  const [layoutSaveName, setLayoutSaveName] = useState("");
  const [savingLayout, setSavingLayout] = useState(false);
  const [applyingLayoutId, setApplyingLayoutId] = useState<string | null>(null);
  // L3: "이전 실행 레이아웃 적용" must NEVER blind-apply -- this dialog is
  // shown before the first apply attempt, regardless of any conflict.
  const [showApplyPreviousConfirm, setShowApplyPreviousConfirm] = useState(false);
  const [applyPreviousConflict, setApplyPreviousConflict] = useState<{
    layoutId: string;
    conflict: LayoutApplyConflict;
  } | null>(null);

  // Reset transient UI state when the session changes -- computed during
  // render (React's documented "adjusting state when a prop changes"
  // pattern) rather than in an effect, so it never fires an extra
  // post-mount render.
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setMarkers([]);
    setSelectedWells([]);
    setPickMarkerId(null);
    setEditingMarker(null);
    setSaveError(null);
  }

  // Load the session's persisted marker set.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await getMarkers(sessionId);
        if (!cancelled) setMarkers(res.markers);
      } catch {
        if (!cancelled) setMarkers([]);
      }
    };
    void load();
    // A layout can now also be applied to THIS session from the Library
    // tab's "레이아웃" sub-tab (a component that isn't a child of this one,
    // unlike the in-context "레이아웃 적용" quick action below) -- refetch
    // when it announces a change so this surface's marker list/unassigned
    // banner never goes stale.
    window.addEventListener("markers-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("markers-changed", load);
    };
  }, [sessionId]);

  // Keep the well-type store in sync with the backend (shared with
  // AnalysisTab's own listener -- both read/write the same source of truth).
  useEffect(() => {
    if (!sessionId) return;
    const load = async () => {
      try {
        const res = await getWellTypes(sessionId);
        setWellTypeAssignments(res.assignments || {});
      } catch {
        // welltypes endpoint may be empty for a fresh session
      }
    };
    load();
    window.addEventListener("welltypes-changed", load);
    return () => window.removeEventListener("welltypes-changed", load);
  }, [sessionId, setWellTypeAssignments]);

  // Load the caller's saved-layout library. Layouts are owned per-USER, not
  // per-session, so this is fetched once on mount rather than re-keyed on
  // sessionId.
  const refreshLayouts = useMemo(
    () => async () => {
      try {
        const res = await listLayouts();
        setLayouts(res.layouts);
      } catch (err) {
        setLayoutError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  useEffect(() => {
    void refreshLayouts();
    // The Library tab's "레이아웃" sub-tab can also save a new snapshot of
    // THIS session -- keep the cached list (used below to compute
    // `previousLayout` for "레이아웃 적용") fresh when that happens.
    window.addEventListener("layouts-changed", refreshLayouts);
    return () => window.removeEventListener("layouts-changed", refreshLayouts);
  }, [refreshLayouts]);

  // Load the caller's marker-catalog library (feat/marker-catalog) -- also
  // per-USER, fetched once on mount. A failure here must never block ad-hoc
  // marker creation, so it's swallowed silently (the catalog picker just
  // stays empty).
  useEffect(() => {
    (async () => {
      try {
        const res = await listMarkerCatalog();
        setCatalogEntries(res.entries);
      } catch {
        setCatalogEntries([]);
      }
    })();
  }, []);

  const catalogById = useMemo(() => {
    const map = new Map<string, MarkerCatalogEntry>();
    for (const e of catalogEntries) map.set(e.id, e);
    return map;
  }, [catalogEntries]);

  const wellToMarker = useMemo(() => {
    const map: Record<string, MarkerRegion> = {};
    for (const m of markers) {
      for (const w of m.wells) map[w] = m;
    }
    return map;
  }, [markers]);

  const unassignedCount = useMemo(() => {
    let n = 0;
    for (const row of plateRows) {
      for (const col of plateCols) {
        if (!wellToMarker[`${row}${col}`]) n++;
      }
    }
    return n;
  }, [plateRows, plateCols, wellToMarker]);

  function toggleWell(id: string) {
    setSelectedWells((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  }

  function toggleCol(col: number) {
    const ids = plateRows.map((r) => `${r}${col}`);
    const allSelected = ids.every((id) => selectedWells.includes(id));
    setSelectedWells((prev) => {
      if (allSelected) return prev.filter((w) => !ids.includes(w));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }

  function toggleRow(row: string) {
    const ids = plateCols.map((c) => `${row}${c}`);
    const allSelected = ids.every((id) => selectedWells.includes(id));
    setSelectedWells((prev) => {
      if (allSelected) return prev.filter((w) => !ids.includes(w));
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return Array.from(next);
    });
  }

  function clearSelection() {
    setSelectedWells([]);
    setPickMarkerId(null);
  }

  function nextColor(current: MarkerRegion[]): string {
    const used = new Set(current.map((m) => m.color).filter(Boolean));
    return (
      MARKER_PALETTE.find((c) => !used.has(c)) ??
      MARKER_PALETTE[current.length % MARKER_PALETTE.length]
    );
  }

  function openNewMarkerForm() {
    setEditingMarker("new");
    setFormName("");
    setFormColor(nextColor(markers));
    setFormPloidy(markers[markers.length - 1]?.ploidy ?? 2);
    setFormCatalogId("");
  }

  function openEditMarkerForm(id: string) {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    setEditingMarker(id);
    setFormName(m.name);
    setFormColor(m.color ?? MARKER_PALETTE[0]);
    setFormPloidy(m.ploidy);
    setFormCatalogId(m.catalog_id ?? "");
  }

  function closeMarkerForm() {
    setEditingMarker(null);
  }

  /** Picking a catalog assay prefills name/ploidy/color from it (task:
   * "let the user pick an existing catalog assay to create/prefill a marker
   * from"). The user can still edit any field further before saving. */
  function pickCatalogEntry(catalogId: string) {
    setFormCatalogId(catalogId);
    if (!catalogId) return;
    const entry = catalogById.get(catalogId);
    if (!entry) return;
    setFormName((prev) => (prev.trim() ? prev : entry.name));
    setFormPloidy(entry.default_ploidy);
    if (entry.color) setFormColor(entry.color);
  }

  async function persist(newMarkers: MarkerRegion[]) {
    if (!sessionId) return newMarkers;
    const persistable = newMarkers.filter((m) => m.wells.length > 0);
    const empties = newMarkers.filter((m) => m.wells.length === 0);
    try {
      setSaveError(null);
      const res = await saveMarkers(sessionId, persistable);
      const merged = [...res.markers, ...empties];
      setMarkers(merged);
      return merged;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return newMarkers;
    }
  }

  async function saveMarkerForm() {
    const name = formName.trim();
    if (!name) return;
    const catalogId = formCatalogId || null;

    if (editingMarker === "new") {
      const id = genMarkerId();
      // A brand-new marker with 0 wells is only ever kept client-side (the
      // backend rejects an empty-wells marker) -- storing catalog_id here
      // means it rides along automatically the moment `persist()` first
      // saves this marker (once it receives wells), without a separate
      // attach-catalog call.
      const created: MarkerRegion = {
        id,
        name,
        wells: [],
        ploidy: formPloidy,
        color: formColor,
        catalog_id: catalogId,
      };
      setMarkers((prev) => [...prev, created]);
      setPickMarkerId(id);
      setEditingMarker(null);
      return;
    }

    if (editingMarker) {
      const editingId = editingMarker;
      const existing = markers.find((m) => m.id === editingId);
      const next = markers.map((m) =>
        m.id === editingId
          ? { ...m, name, color: formColor, ploidy: formPloidy, catalog_id: catalogId }
          : m
      );
      setMarkers(next);
      setEditingMarker(null);

      const target = next.find((m) => m.id === editingId);
      if (!target || target.wells.length === 0) return; // not yet persisted server-side

      // Marker already exists on the backend: name/color/ploidy go through
      // the normal bulk persist; a NEW catalog link additionally needs the
      // dedicated attach-catalog endpoint (the bulk marker-set PUT/POST
      // doesn't itself run the catalog prefill logic).
      const merged = await persist(next);
      if (catalogId && catalogId !== (existing?.catalog_id ?? null) && sessionId) {
        try {
          const attached = await attachMarkerCatalog(sessionId, editingId, catalogId);
          setMarkers((prev) => prev.map((m) => (m.id === editingId ? attached : m)));
        } catch (err) {
          setSaveError(
            err instanceof Error
              ? err.message
              : String(err)
          );
        }
      }
      void merged;
    }
  }

  async function applyAssign() {
    if (!pickMarkerId || selectedWells.length === 0) return;
    const targetId = pickMarkerId;
    const newMarkers = markers.map((m) => ({
      ...m,
      wells:
        m.id === targetId
          ? Array.from(new Set([...m.wells, ...selectedWells]))
          : m.wells.filter((w) => !selectedWells.includes(w)),
    }));
    await persist(newMarkers);
    setSelectedWells([]);
    setPickMarkerId(null);
  }

  async function unassignSelected() {
    if (selectedWells.length === 0) return;
    const newMarkers = markers.map((m) => ({
      ...m,
      wells: m.wells.filter((w) => !selectedWells.includes(w)),
    }));
    await persist(newMarkers);
    setSelectedWells([]);
  }

  async function setWellType(value: string) {
    if (!sessionId || selectedWells.length === 0) return;
    const prevAssignments = wellTypeAssignments;
    const optimistic = { ...prevAssignments };
    selectedWells.forEach((w) => {
      optimistic[w] = value;
    });
    setWellTypeAssignments(optimistic);
    try {
      await apiSetWellTypes(sessionId, {
        wells: selectedWells,
        well_type: value as WellType,
      });
      window.dispatchEvent(new CustomEvent("welltypes-changed"));
    } catch (err) {
      setWellTypeAssignments(prevAssignments);
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  // ---- Layout library (P4-S3) -- CONTEXTUAL quick actions only ----------
  // The full browse/manage UI (list every saved layout, rename/copy/delete)
  // now lives in the top-level Library tab's "레이아웃" sub-tab
  // (LayoutsLibraryPanel). This surface keeps only the two actions that
  // operate on THIS session's plate: saving its current assignment as a new
  // layout, and applying the most-recently-saved layout to it.

  /** Applies one saved layout to the current session and refreshes the
   * locally-held marker set (so both the plate grid here AND the Analysis
   * surface -- which re-clusters whenever its `markers` prop changes --
   * reflect the applied layout without a page reload). */
  async function applyLayoutToSession(layoutId: string, force: boolean) {
    if (!sessionId) return;
    const result = await applyLayout(layoutId, { sid: sessionId, force });
    setMarkers(result.markers);
    setSelectedWells([]);
    setPickMarkerId(null);
    window.dispatchEvent(new CustomEvent("welltypes-changed"));
    // The Library tab's layouts sub-tab doesn't hold its own copy of this
    // session's markers, but announcing this keeps behavior symmetric with
    // the reverse direction (a Library-triggered apply notifying this
    // surface -- see the "markers-changed" listener above).
    window.dispatchEvent(new CustomEvent("markers-changed"));
  }

  function openLayoutSaveForm() {
    setLayoutError(null);
    setLayoutSaveName("");
    setShowLayoutSaveForm(true);
  }

  function cancelLayoutSaveForm() {
    setShowLayoutSaveForm(false);
    setLayoutSaveName("");
  }

  async function confirmSaveLayout() {
    const name = layoutSaveName.trim();
    if (!name || !sessionId) return;
    setSavingLayout(true);
    setLayoutError(null);
    try {
      await saveLayout(name, sessionId);
      setShowLayoutSaveForm(false);
      setLayoutSaveName("");
      await refreshLayouts();
      // Keep the Library tab's layouts sub-tab (if/when it's open) in sync
      // with a save that happened from this contextual quick action.
      window.dispatchEvent(new CustomEvent("layouts-changed"));
    } catch (err) {
      setLayoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLayout(false);
    }
  }

  // "이전 실행 레이아웃 적용" -- the most recently saved layout (backend
  // lists newest-first). L3: opens the confirm dialog BEFORE any apply
  // attempt, unconditionally -- never a blind/silent apply.
  const previousLayout = layouts[0] ?? null;

  function openApplyPreviousConfirm() {
    setLayoutError(null);
    setApplyPreviousConflict(null);
    setShowApplyPreviousConfirm(true);
  }

  function cancelApplyPreviousConfirm() {
    setShowApplyPreviousConfirm(false);
    setApplyPreviousConflict(null);
  }

  async function confirmApplyPrevious() {
    if (!previousLayout) {
      setShowApplyPreviousConfirm(false);
      setLayoutError(t.wsLayoutNoPreviousError);
      return;
    }
    setApplyingLayoutId(previousLayout.id);
    try {
      await applyLayoutToSession(previousLayout.id, false);
      setShowApplyPreviousConfirm(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const conflict = extractLayoutConflict(err);
        if (conflict) {
          setApplyPreviousConflict({ layoutId: previousLayout.id, conflict });
          return;
        }
      }
      setShowApplyPreviousConfirm(false);
      if (err instanceof ApiError && err.status === 400) {
        setLayoutError(extractLayoutMissingWellsMessage(err));
      } else {
        setLayoutError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setApplyingLayoutId(null);
    }
  }

  async function confirmApplyPreviousForce() {
    if (!applyPreviousConflict) return;
    setApplyingLayoutId(applyPreviousConflict.layoutId);
    try {
      await applyLayoutToSession(applyPreviousConflict.layoutId, true);
      setShowApplyPreviousConfirm(false);
      setApplyPreviousConflict(null);
    } catch (err) {
      setLayoutError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingLayoutId(null);
    }
  }

  const singleWell = selectedWells.length === 1 ? selectedWells[0] : null;
  const singleWellMarker = singleWell ? wellToMarker[singleWell] : undefined;
  // C5: a marker with ploidy>2 has no single heterozygote (mid-dosage classes
  // instead) -- only offer the 이형접합 control for diploid markers/unassigned
  // wells.
  const hideHet = !!singleWellMarker && singleWellMarker.ploidy > 2;
  const currentWellType = singleWell ? wellTypeAssignments[singleWell] : undefined;

  return (
    <div className="p-6">
      {saveError && (
        <div className="mb-3 px-3 py-2 rounded-md text-sm text-danger bg-danger/10">
          {saveError}
        </div>
      )}

      {unassignedCount > 0 && (
        <div
          data-testid="unassigned-banner"
          className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md text-sm"
          style={{ background: "rgba(217,119,6,0.12)", border: "1px solid rgba(217,119,6,0.35)" }}
        >
          <span data-testid="unassigned-count" className="font-semibold text-text">
            {t.wsUnassignedBanner(unassignedCount)}
          </span>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "260px minmax(0,1fr) 280px" }}>
        <div className="flex flex-col gap-4">
        {/* Marker list */}
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3 text-text">{t.wsTabPlate}</h3>
          {markers.map((m) => (
            <div
              key={m.id}
              data-testid="marker-card"
              role="button"
              tabIndex={0}
              onClick={() => setPickMarkerId(m.id)}
              className="w-full text-left border border-border bg-bg rounded-md p-2.5 mb-2 cursor-pointer"
              style={pickMarkerId === m.id ? { boxShadow: "0 0 0 2px var(--color-primary) inset" } : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: m.color ?? MARKER_PALETTE[0] }}
                />
                <span className="font-semibold text-sm text-text flex-1 truncate">{m.name}</span>
                <span className="text-xs font-bold text-primary bg-bg rounded px-1.5 py-0.5">
                  {t.wsMarkerPloidyUnit(m.ploidy)}
                </span>
                {m.catalog_id && (
                  <span
                    data-testid="marker-card-catalog-link"
                    title={catalogById.get(m.catalog_id)?.name ?? m.catalog_id}
                    className="text-xs text-text-muted"
                  >
                    🔗
                  </span>
                )}
                <button
                  type="button"
                  title={t.wsMarkerFormTitleEdit}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditMarkerForm(m.id);
                  }}
                  className="text-text-muted hover:text-text cursor-pointer"
                >
                  ✎
                </button>
              </div>
              <div className="mt-1.5 text-xs text-text-muted">
                {t.wsMarkerSampleCount(m.wells.length)}
              </div>
            </div>
          ))}

          {editingMarker && (
            <div
              data-testid="marker-form"
              className="border border-primary rounded-md p-3 mb-2"
            >
              <p className="text-xs font-bold text-text-muted mb-1.5">
                {editingMarker === "new" ? t.wsMarkerFormTitleNew : t.wsMarkerFormTitleEdit}
              </p>

              {catalogEntries.length > 0 && (
                <>
                  <p className="text-xs font-bold text-text-muted mb-1.5">
                    {t.wsMarkerCatalogSelectLabel}
                  </p>
                  <select
                    data-testid="marker-form-catalog-select"
                    value={formCatalogId}
                    onChange={(e) => pickCatalogEntry(e.target.value)}
                    className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text mb-2.5"
                  >
                    <option value="">{t.wsMarkerCatalogSelectNone}</option>
                    {catalogEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <input
                data-testid="marker-name-input"
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveMarkerForm();
                }}
                placeholder={t.wsMarkerNamePlaceholder}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text"
              />

              <p className="text-xs font-bold text-text-muted mt-2.5 mb-1.5">
                {t.wsMarkerColorLabel}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MARKER_PALETTE.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    data-testid={`marker-color-swatch-${i}`}
                    aria-pressed={formColor === c}
                    aria-label={t.wsMarkerColorLabel}
                    onClick={() => setFormColor(c)}
                    style={{
                      background: c,
                      outline: formColor === c ? "2px solid var(--color-text)" : "none",
                      outlineOffset: "1px",
                    }}
                    className="w-[22px] h-[22px] rounded-md border-2 border-transparent cursor-pointer"
                  />
                ))}
              </div>

              <p className="text-xs font-bold text-text-muted mt-2.5 mb-1.5">
                {t.wsMarkerPloidyLabel}
              </p>
              <select
                data-testid="marker-ploidy-select"
                value={String(formPloidy)}
                onChange={(e) => setFormPloidy(Number(e.target.value))}
                className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-surface text-text"
              >
                {PLOIDY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t.wsMarkerPloidyUnit(p)}
                  </option>
                ))}
              </select>

              <div className="flex gap-1.5 mt-2.5">
                <button
                  type="button"
                  data-testid="marker-form-save"
                  onClick={saveMarkerForm}
                  className="flex-1 rounded-md py-1.5 font-semibold text-sm bg-primary text-white cursor-pointer"
                >
                  {t.wsMarkerFormSave}
                </button>
                <button
                  type="button"
                  data-testid="marker-form-cancel"
                  onClick={closeMarkerForm}
                  className="flex-1 rounded-md py-1.5 font-semibold text-sm bg-bg text-text-muted cursor-pointer"
                >
                  {t.wsMarkerFormCancel}
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            data-testid="add-marker-button"
            onClick={openNewMarkerForm}
            className="w-full border border-dashed border-border rounded-md py-2 text-sm font-medium text-text-muted hover:text-primary hover:border-primary cursor-pointer"
          >
            {t.wsAddMarkerButton}
          </button>
        </div>

        {/* Layout quick actions (P4-S3 contextual) -- full browse/manage now
            lives in the top-level Library tab's "레이아웃" sub-tab. */}
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3 text-text">{t.wsLayoutLibraryTitle}</h3>

          {layoutError && (
            <div className="mb-2 px-2.5 py-2 rounded-md text-xs text-danger bg-danger/10">
              {layoutError}
            </div>
          )}

          {showLayoutSaveForm ? (
            <div className="flex gap-1.5 mb-2">
              <input
                data-testid="layout-save-name-input"
                type="text"
                value={layoutSaveName}
                onChange={(e) => setLayoutSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmSaveLayout();
                }}
                placeholder={t.wsLayoutSaveNamePlaceholder}
                className="flex-1 min-w-0 border border-primary rounded-md px-2 py-1.5 text-xs bg-surface text-text"
              />
              <button
                type="button"
                data-testid="layout-save-confirm"
                disabled={savingLayout || !layoutSaveName.trim()}
                onClick={confirmSaveLayout}
                className="flex-none rounded-md px-3 py-1.5 text-xs font-semibold bg-primary text-white disabled:opacity-40 cursor-pointer"
              >
                {t.save}
              </button>
              <button
                type="button"
                data-testid="layout-save-cancel"
                onClick={cancelLayoutSaveForm}
                className="flex-none rounded-md px-2.5 py-1.5 text-xs font-medium text-text-muted cursor-pointer"
              >
                {t.cancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="layout-save-open"
              disabled={markers.length === 0}
              onClick={openLayoutSaveForm}
              title={markers.length === 0 ? t.wsNoMarkersHint : undefined}
              className="w-full border border-dashed border-border rounded-md py-2 text-xs font-medium text-text-muted hover:text-primary hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer mb-2"
            >
              {t.wsLayoutSaveOpenButton}
            </button>
          )}

          <button
            type="button"
            data-testid="apply-previous-layout-button"
            onClick={openApplyPreviousConfirm}
            className="w-full border border-border rounded-md py-2 text-xs font-semibold text-text hover:border-primary hover:text-primary cursor-pointer"
          >
            {t.wsApplyPreviousLayoutButton}
          </button>

          {showApplyPreviousConfirm && (
            <div
              data-testid="apply-previous-layout-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <div className="bg-surface border border-border rounded-lg p-5 max-w-sm w-full">
                {applyPreviousConflict ? (
                  <>
                    <p className="text-sm font-semibold text-text mb-2">
                      {t.wsLayoutPloidyConflictTitle}
                    </p>
                    <p className="text-sm text-text-muted mb-4">
                      {t.wsLayoutPloidyConflictBody(
                        applyPreviousConflict.conflict.conflicting_marker_ids.join(", ")
                      )}
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        data-testid="apply-previous-layout-cancel"
                        onClick={cancelApplyPreviousConfirm}
                        className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg text-text-muted cursor-pointer"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        data-testid="apply-previous-layout-confirm"
                        disabled={applyingLayoutId !== null}
                        onClick={confirmApplyPreviousForce}
                        className="px-3 py-1.5 rounded-md text-sm font-semibold bg-danger text-white disabled:opacity-40 cursor-pointer"
                      >
                        {t.wsLayoutForceApplyButton}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-text mb-2">
                      {t.wsApplyPreviousConfirmTitle}
                    </p>
                    <p className="text-sm text-text-muted mb-4">
                      {previousLayout
                        ? t.wsApplyPreviousConfirmBody(previousLayout.name)
                        : t.wsLayoutNoPreviousError}
                    </p>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        data-testid="apply-previous-layout-cancel"
                        onClick={cancelApplyPreviousConfirm}
                        className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg text-text-muted cursor-pointer"
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        data-testid="apply-previous-layout-confirm"
                        disabled={applyingLayoutId !== null}
                        onClick={confirmApplyPrevious}
                        className="px-3 py-1.5 rounded-md text-sm font-semibold bg-primary text-white disabled:opacity-40 cursor-pointer"
                      >
                        {t.apply}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        </div>

        {/* Plate grid */}
        <div className="panel">
          {selectedWells.length > 0 ? (
            <div data-testid="selection-bar" className="flex flex-wrap items-center gap-3 mb-3">
              <span data-testid="selection-count" className="text-sm font-semibold text-text">
                {t.wsSelectionCount(selectedWells.length)}
              </span>
              {markers.length === 0 ? (
                <span className="text-xs text-text-muted">{t.wsNoMarkersHint}</span>
              ) : (
                <div className="flex gap-1 bg-bg border border-border rounded-md p-1">
                  {markers.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-testid="marker-pick-button"
                      aria-pressed={pickMarkerId === m.id}
                      onClick={() => setPickMarkerId(m.id)}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                        pickMarkerId === m.id ? "bg-surface text-text" : "text-text-muted"
                      }`}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-sm"
                        style={{ background: m.color ?? MARKER_PALETTE[0] }}
                      />
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                data-testid="assign-button"
                disabled={!pickMarkerId}
                onClick={applyAssign}
                className="ml-auto px-4 py-1.5 rounded-md text-sm font-semibold bg-primary text-white disabled:opacity-40 cursor-pointer"
              >
                {t.wsAssignButton}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="px-3 py-1.5 rounded-md text-sm text-text-muted hover:text-text cursor-pointer"
              >
                {t.wsClearSelection}
              </button>
            </div>
          ) : (
            <p className="text-xs text-text-muted mb-3">{t.wsPlateHint}</p>
          )}

          <div style={{ overflowX: "auto" }}>
            <div
              className="select-none"
              style={{
                display: "grid",
                gridTemplateColumns: `auto repeat(${plateCols.length}, 1fr)`,
                gap: "4px",
              }}
            >
              <div />
              {plateCols.map((col) => (
                <button
                  key={`col-${col}`}
                  type="button"
                  data-testid={`col-header-${col}`}
                  onClick={() => toggleCol(col)}
                  className="text-xs font-semibold text-text-muted hover:text-primary cursor-pointer text-center"
                >
                  {col}
                </button>
              ))}
              {plateRows.map((row) => (
                <Fragment key={row}>
                  <button
                    type="button"
                    data-testid={`row-header-${row}`}
                    onClick={() => toggleRow(row)}
                    className="text-xs font-semibold text-text-muted hover:text-primary cursor-pointer px-1"
                  >
                    {row}
                  </button>
                  {plateCols.map((col) => {
                    const id = `${row}${col}`;
                    const marker = wellToMarker[id];
                    const isSelected = selectedWells.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        data-testid={`well-${id}`}
                        aria-pressed={isSelected}
                        data-assigned={marker ? "true" : "false"}
                        onClick={() => toggleWell(id)}
                        title={id}
                        style={{
                          background: marker ? marker.color ?? undefined : undefined,
                          outline: isSelected ? "2px solid var(--color-primary)" : "none",
                          outlineOffset: "1px",
                          aspectRatio: "1",
                        }}
                        className={`rounded-full border cursor-pointer text-[8px] font-mono ${
                          marker
                            ? "border-transparent text-white"
                            : "bg-bg border-border text-text-muted"
                        }`}
                      >
                        {id}
                      </button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </div>

        {/* Well inspector */}
        <div className="panel">
          <h3 className="text-sm font-semibold mb-3 text-text">{t.wsWellInspectorTitle}</h3>
          {selectedWells.length > 0 ? (
            <div data-testid="well-inspector">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  data-testid="well-type-sample"
                  aria-pressed={currentWellType === WellType.UNKNOWN}
                  onClick={() => setWellType(WellType.UNKNOWN)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                    currentWellType === WellType.UNKNOWN ? "bg-primary text-white" : "bg-bg text-text"
                  }`}
                >
                  {t.wsWellTypeSample}
                </button>
                <button
                  type="button"
                  data-testid="well-type-ntc"
                  aria-pressed={currentWellType === WellType.NTC}
                  onClick={() => setWellType(WellType.NTC)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                    currentWellType === WellType.NTC ? "bg-primary text-white" : "bg-bg text-text"
                  }`}
                >
                  {t.wsWellTypeNtc}
                </button>
                <button
                  type="button"
                  data-testid="well-type-a1"
                  aria-pressed={currentWellType === WellType.ALLELE1_CONTROL}
                  onClick={() => setWellType(WellType.ALLELE1_CONTROL)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                    currentWellType === WellType.ALLELE1_CONTROL ? "bg-primary text-white" : "bg-bg text-text"
                  }`}
                >
                  {t.wsWellTypeA1}
                </button>
                <button
                  type="button"
                  data-testid="well-type-a2"
                  aria-pressed={currentWellType === WellType.ALLELE2_CONTROL}
                  onClick={() => setWellType(WellType.ALLELE2_CONTROL)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                    currentWellType === WellType.ALLELE2_CONTROL ? "bg-primary text-white" : "bg-bg text-text"
                  }`}
                >
                  {t.wsWellTypeA2}
                </button>
                {!hideHet && (
                  <button
                    type="button"
                    data-testid="well-type-het"
                    aria-pressed={currentWellType === WellType.HETEROZYGOUS}
                    onClick={() => setWellType(WellType.HETEROZYGOUS)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                      currentWellType === WellType.HETEROZYGOUS ? "bg-primary text-white" : "bg-bg text-text"
                    }`}
                  >
                    {t.wsWellTypeHet}
                  </button>
                )}
                <button
                  type="button"
                  data-testid="well-type-no-amp"
                  aria-pressed={currentWellType === WellType.OMIT}
                  onClick={() => setWellType(WellType.OMIT)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer border border-border ${
                    currentWellType === WellType.OMIT ? "bg-primary text-white" : "bg-bg text-text"
                  }`}
                >
                  {t.wsWellTypeNoAmp}
                </button>
              </div>

              <button
                type="button"
                data-testid="unassign-button"
                onClick={unassignSelected}
                className="w-full mt-3 px-3 py-1.5 rounded-md text-sm font-medium border border-border bg-bg text-text-muted hover:text-text cursor-pointer"
              >
                {t.wsUnassignButton}
              </button>
            </div>
          ) : (
            <p className="text-xs text-text-muted">{t.wsInspectorEmptyNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

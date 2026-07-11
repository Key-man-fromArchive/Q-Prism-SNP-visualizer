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
} from "@/lib/api";
import type { MarkerRegion } from "@/types/api";
import { WellType } from "@/types/api";
import { MARKER_PALETTE } from "@/lib/constants";

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
    (async () => {
      try {
        const res = await getMarkers(sessionId);
        if (!cancelled) setMarkers(res.markers);
      } catch {
        if (!cancelled) setMarkers([]);
      }
    })();
    return () => {
      cancelled = true;
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
  }

  function openEditMarkerForm(id: string) {
    const m = markers.find((x) => x.id === id);
    if (!m) return;
    setEditingMarker(id);
    setFormName(m.name);
    setFormColor(m.color ?? MARKER_PALETTE[0]);
    setFormPloidy(m.ploidy);
  }

  function closeMarkerForm() {
    setEditingMarker(null);
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

  function saveMarkerForm() {
    const name = formName.trim();
    if (!name) return;

    if (editingMarker === "new") {
      const id = genMarkerId();
      const created: MarkerRegion = {
        id,
        name,
        wells: [],
        ploidy: formPloidy,
        color: formColor,
      };
      setMarkers((prev) => [...prev, created]);
      setPickMarkerId(id);
    } else if (editingMarker) {
      const editingId = editingMarker;
      const next = markers.map((m) =>
        m.id === editingId ? { ...m, name, color: formColor, ploidy: formPloidy } : m
      );
      setMarkers(next);
      const target = next.find((m) => m.id === editingId);
      if (target && target.wells.length > 0) {
        void persist(next);
      }
    }
    setEditingMarker(null);
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

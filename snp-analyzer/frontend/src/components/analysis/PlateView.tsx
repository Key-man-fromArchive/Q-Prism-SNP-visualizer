// @TASK Frontend - Plate View Component
// @SPEC Renders 96-well plate grid with drag selection and genotype coloring

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { getPlate } from '@/lib/api';
import { WELL_TYPE_INFO } from '@/lib/constants';
import { wellInfo, dosageOfLabel } from '@/lib/genotype';
import { callAppearance, displayedCall, outsideDisplayScope } from '@/lib/chart-semantics';
import { useWellFilter } from '@/hooks/use-well-filter';
import { useWellGrid } from '@/hooks/use-well-grid';
import { useI18n } from '@/hooks/use-i18n';
import { StatusState } from '@/components/shared/ui';
import type { PlateWell } from '@/types/api';
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import { useQualityFocus } from '@/hooks/use-quality-focus';

interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type PlateViewProps = {
  scopeWells?: readonly string[];
  ploidyOverride?: number;
};

export function PlateView({ scopeWells, ploidyOverride }: PlateViewProps = {}) {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  const panelRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  useQualityFocus(gridRef, 'analysis');

  // Stores
  const sessionId = useSessionStore((s) => s.sessionId);
  const showManualTypes = useSettingsStore((s) => s.showManualTypes);
  const showAutoCluster = useSettingsStore((s) => s.showAutoCluster);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const storedPloidy = useSettingsStore((s) => s.ploidy);
  const ploidy = ploidyOverride ?? storedPloidy;
  const selectedWell = useSelectionStore((s) => s.selectedWell);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const selectWells = useSelectionStore((s) => s.selectWells);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const plateWells = useDataStore((s) => s.plateWells);
  const setPlateData = useDataStore((s) => s.setPlateData);

  // Drag selection state
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragRectRef = useRef<DragRect | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const dragAdditiveRef = useRef(false);
  const didDragRef = useRef(false);
  const dragThreshold = 5;

  // Re-fetch trigger (incremented when well types change)
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setRefetchTrigger((n) => n + 1);
    window.addEventListener("welltypes-changed", handler);
    return () => window.removeEventListener("welltypes-changed", handler);
  }, []);

  // Fetch plate data when dependencies change
  const fetchPlateData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const owner = useAnalysisStore.getState();
    const entry = useSessionStore.getState().entryGeneration;
    const isCurrent = () => sequence === requestSequence.current
      && entry === useSessionStore.getState().entryGeneration
      && owner.ownerId === useAnalysisStore.getState().ownerId
      && owner.sessionId === useAnalysisStore.getState().sessionId;
    if (!sessionId) {
      setStatus("loading");
      return;
    }
    setStatus((s) => (s === "ready" ? s : "loading"));
    setFetchError(null);
    try {
      const res = await getPlate(sessionId, currentCycle, useRox, backgroundMode);
      if (!isCurrent()) return;
      setPlateData(res.wells);
      setStatus("ready");
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Failed to fetch plate data:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  }, [sessionId, currentCycle, useRox, backgroundMode, setPlateData]);

  useEffect(() => {
    // Network completion, not this effect body, performs the state update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPlateData();
    return () => { requestSequence.current += 1; };
  }, [fetchPlateData, refetchTrigger]);

  const { plateRows, plateCols, isWellVisible } = useWellFilter();
  const keyboardGrid = useWellGrid(plateRows, plateCols, plateWells.map(well => well.well));
  const isLargePlate = plateCols.length > 12;

  // Build wellMap for quick lookup
  const wellMap = useMemo(() => {
    const map = new Map();
    for (const w of plateWells) {
      map.set(w.well, w);
    }
    return map;
  }, [plateWells]);

  // Calculate well color based on type or ratio
  const getWellColor = (wellData: PlateWell | undefined): string => {
    if (!wellData) return '';

    // Determine effective type
    let effectiveType = null;
    if (showManualTypes && wellData.manual_type) {
      effectiveType = wellData.manual_type;
    } else if (showAutoCluster && wellData.auto_cluster !== null && wellData.auto_cluster !== undefined) {
      effectiveType = wellData.auto_cluster;
    }

    // Use type color if available (dosage genotype for the current ploidy, or a
    // fixed control/non-genotype type).
    if (
      effectiveType !== null &&
      (dosageOfLabel(effectiveType, ploidy) !== null ||
        effectiveType in WELL_TYPE_INFO)
    ) {
      return wellInfo(effectiveType, ploidy, dark).color;
    }

    // Fall back to ratio gradient
    const ratio = wellData.ratio ?? 0.5;
    const r = Math.round(220 * (1 - ratio) + 37 * ratio);
    const g = Math.round(38 * (1 - ratio) + 99 * ratio);
    const b = Math.round(38 * (1 - ratio) + 235 * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Handle drag start
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    // The plate surface is a selection canvas. Preserve the button's focus
    // affordance while preventing the browser from starting a text selection
    // when the pointer travels across labels or empty panel space.
    const button = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>('button')
      : null;
    if (button) {
      button.focus();
    } else {
      event.preventDefault();
    }
    dragAdditiveRef.current = event.ctrlKey || event.metaKey;
    didDragRef.current = false;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragRectRef.current = null;
  };

  // Handle drag move
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart) return;

    const deltaX = Math.abs(event.clientX - dragStart.x);
    const deltaY = Math.abs(event.clientY - dragStart.y);

    // Start dragging if moved beyond threshold
    if (!didDragRef.current && (deltaX > dragThreshold || deltaY > dragThreshold)) {
      didDragRef.current = true;
      // Capturing on pointerdown retargets the subsequent native child click.
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    }

    if (didDragRef.current) {
      const left = Math.min(dragStart.x, event.clientX);
      const top = Math.min(dragStart.y, event.clientY);
      const width = Math.abs(event.clientX - dragStart.x);
      const height = Math.abs(event.clientY - dragStart.y);

      const next = { left, top, width, height };
      dragRectRef.current = next;
      const overlay = dragOverlayRef.current;
      if (overlay) {
        overlay.style.display = 'block';
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
      }
    }
  };

  // Handle drag end
  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragRect = dragRectRef.current;
    if (event.type !== "pointercancel" && didDragRef.current && dragRect && gridRef.current) {
      // Find wells within selection rectangle
      const wellElements = gridRef.current.querySelectorAll('.plate-well[data-well]');
      const selectedWellIds: string[] = [];

      wellElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        if (
          centerX >= dragRect.left &&
          centerX <= dragRect.left + dragRect.width &&
          centerY >= dragRect.top &&
          centerY <= dragRect.top + dragRect.height
        ) {
          const wellId = el.getAttribute('data-well');
          if (wellId) {
            selectedWellIds.push(wellId);
          }
        }
      });

      if (dragAdditiveRef.current) {
        selectWells(Array.from(new Set([...selectedWells, ...selectedWellIds])));
      } else {
        selectWells(selectedWellIds);
      }
    }

    dragStartRef.current = null;
    dragRectRef.current = null;
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = 'none';
    if (typeof event.currentTarget.hasPointerCapture === "function"
      && event.currentTarget.hasPointerCapture(event.pointerId)
      && typeof event.currentTarget.releasePointerCapture === "function") {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Do not let the drag guard swallow the next keyboard or pointer action.
    didDragRef.current = false;
  };

  // ── Keyboard grid navigation (roving tabindex, PRD FR-X-3) ─────────────────
  const wellIdAt = (r: number, c: number) => `${plateRows[r]}${plateCols[c]}`;

  // Toggle a set of wells: if all are already selected, remove them; else add.
  const toggleWells = (ids: string[]) => {
    if (ids.length === 0) return;
    const cur = new Set(selectedWells);
    const allSelected = ids.every((w) => cur.has(w));
    for (const w of ids) {
      if (allSelected) cur.delete(w);
      else cur.add(w);
    }
    const next = [...cur];
    if (next.length) selectWells(next);
    else clearSelection();
  };


  const toggleColumn = (c: number) =>
    toggleWells(plateRows.map((_, r) => wellIdAt(r, c)).filter((w) => wellMap.has(w)));
  const toggleRow = (r: number) =>
    toggleWells(plateCols.map((_, c) => wellIdAt(r, c)).filter((w) => wellMap.has(w)));

  return (
    <div
      className="panel plate-panel select-none"
      ref={panelRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <h3 className="text-sm font-semibold mb-3 text-text">{t.plateView} ({plateRows.length}×{plateCols.length})</h3>
      <p role="status" aria-live="polite" className="sr-only">{t.selectedWellCount(selectedWells.length)}</p>

      {status === "loading" && <StatusState variant="loading" message={t.loading} />}
      {status === "error" && (
        <StatusState
          variant="error"
          message={t.statusLoadFailed}
          detail={fetchError ?? undefined}
          action={{ label: t.retry, onClick: () => void fetchPlateData() }}
        />
      )}
      {status === "ready" && plateWells.length === 0 && (
        <StatusState variant="empty" message={t.plateEmpty} />
      )}

      <div role="region" aria-label={t.plateScrollHint} tabIndex={0} data-testid="plate-scroll-region"
        style={{ overflowX: 'auto', display: status === "ready" && plateWells.length > 0 ? undefined : 'none' }}>
      <p className="text-xs text-text-muted mb-2">{t.plateScrollHint}</p>
      <div
        id="plate-grid"
        role="grid"
        aria-label={t.plateGridAria}
        className="plate-grid select-none"
        ref={gridRef}
        onKeyDown={keyboardGrid.onKeyDown}
        style={{
          display: 'grid',
          gridTemplateColumns: `auto repeat(${plateCols.length}, 1fr)`,
          gridTemplateRows: `auto repeat(${plateRows.length}, 1fr)`,
          gap: '2px',
          maxWidth: isLargePlate ? '820px' : '380px',
          margin: '0 auto'
        }}
      >
        {/* Corner cell */}
        <div role="row" style={{ display: 'contents' }}>
        <div role="columnheader" className="plate-label" />

        {/* Column headers (click / Enter toggles the whole column) */}
        {plateCols.map((col, cIdx) => (
          <button
            key={`col-${col}`}
            {...keyboardGrid.cell(-1, cIdx)}
            type="button"
            role="columnheader"
            aria-label={t.toggleColumnAria(col)}
            onClick={() => {
              if (didDragRef.current) {
                didDragRef.current = false;
                return;
              }
              toggleColumn(cIdx);
            }}
            className="plate-label text-center text-text-muted font-medium py-1 bg-transparent border-none cursor-pointer hover:text-primary"
            style={{ fontSize: isLargePlate ? '0.6rem' : '0.75rem' }}
          >
            {col}
          </button>
        ))}
        </div>

        {/* Rows with wells */}
        {plateRows.map((row, rIdx) => (
          <div role="row" key={row} style={{ display: 'contents' }}>
            {/* Row header (click / Enter toggles the whole row) */}
            <button
              {...keyboardGrid.cell(rIdx, -1)}
              type="button"
              role="rowheader"
              aria-label={t.toggleRowAria(row)}
              onClick={() => {
                if (didDragRef.current) {
                  didDragRef.current = false;
                  return;
                }
                toggleRow(rIdx);
              }}
              className="plate-label text-center text-text-muted font-medium px-2 bg-transparent border-none cursor-pointer hover:text-primary"
              style={{ fontSize: isLargePlate ? '0.6rem' : '0.75rem' }}
            >
              {row}
            </button>

            {/* Wells in this row */}
            {plateCols.map((col, cIdx) => {
              const wellId = `${row}${col}`;
              const wellData = wellMap.get(wellId);
              const isSelected = selectedWell === wellId;
              const isMultiSelected = selectedWells.includes(wellId);
              const isAnySelected = isSelected || isMultiSelected;
              const hasData = !!wellData;
              const isEmpty = !hasData;
              // Has data but excluded from plots (omitted, group-filtered, or hidden Empty)
              const isExcluded = hasData && !isWellVisible(wellId);
              const isOutOfScope = hasData && outsideDisplayScope(wellId, scopeWells);

              const wellColor = isEmpty ? '' : getWellColor(wellData);
              const call = callAppearance(displayedCall(wellData, showManualTypes, showAutoCluster), ploidy, dark, t);
              const cellSize = isLargePlate ? '18px' : '28px';

              const stateSuffix = isSelected || isMultiSelected
                ? `, ${t.wellSelectedState}`
                : isEmpty
                ? `, ${t.wellEmptyState}`
                : '';
              const ariaLabel = `${wellId}${wellData?.sample_name ? `, ${wellData.sample_name}` : ''}, ${call.description}${stateSuffix}`;

              return (
                <button
                  {...keyboardGrid.cell(rIdx, cIdx)}
                  key={wellId}
                  type="button"
                  role="gridcell"
                  data-well={wellId}
                  aria-label={ariaLabel}
                  aria-selected={isSelected || isMultiSelected}
                  className={`
                    plate-well
                    rounded
                    cursor-pointer
                    border-none
                    transition-all
                    duration-200
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1
                    ${isEmpty ? 'empty bg-bg opacity-40' : ''}
                    ${isExcluded ? 'opacity-40' : ''}
                    ${isOutOfScope ? 'opacity-20' : ''}
                    ${isAnySelected ? 'selected relative z-10 scale-110 ring-[3px] ring-amber-400 ring-offset-2 shadow-md' : ''}
                  `}
                  style={{
                    backgroundColor: wellColor || undefined,
                    minWidth: cellSize,
                    minHeight: cellSize,
                    aspectRatio: '1',
                  }}
                  onClick={(e) => {
                    if (didDragRef.current) { didDragRef.current = false; return; }
                    if (!isEmpty) keyboardGrid.cell(rIdx, cIdx).onClick(e);
                  }}
                  title={
                    wellData
                      ? `${t.chartWellAddress}: ${wellId}; ${t.chartCall}: ${call.description}; ${wellData.sample_name || t.chartNoSample}${isExcluded ? ` (${t.chartExcluded})` : ''}${isOutOfScope ? ` (${t.chartOutsideMarker})` : ''}`
                      : wellId
                  }
                >
                  <span aria-hidden="true" style={{ color: call.textColor, fontSize: '10px', lineHeight: 1 }}>{call.glyph}</span>
                  {isAnySelected && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black leading-none text-black shadow"
                    >
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      </div>

      {/* Drag selection rectangle */}
      <div
        ref={dragOverlayRef}
        className="drag-selection-rect"
        style={{
          display: 'none',
          position: 'fixed',
          border: '2px solid rgb(37, 99, 235)',
          background: 'rgba(37, 99, 235, 0.16)',
          pointerEvents: 'none',
          zIndex: 50,
          borderRadius: '4px'
        }}
      />
    </div>
  );
}

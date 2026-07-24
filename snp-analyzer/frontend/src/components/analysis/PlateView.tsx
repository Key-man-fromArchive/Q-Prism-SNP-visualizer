// @TASK Frontend - Plate View Component
// @SPEC Renders 96-well plate grid with drag selection and genotype coloring

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { getPlate } from '@/lib/api';
import { WELL_TYPE_INFO } from '@/lib/constants';
import { wellInfo, dosageOfLabel } from '@/lib/genotype';
import { useWellFilter } from '@/hooks/use-well-filter';
import { useI18n } from '@/hooks/use-i18n';
import { StatusState } from '@/components/shared/ui';

interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PlateView() {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Stores
  const sessionId = useSessionStore((s) => s.sessionId);
  const { showManualTypes, showAutoCluster } = useSettingsStore();
  const useRox = useSettingsStore((s) => s.useRox);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const { selectedWell, selectedWells, selectWell, selectWells, clearSelection, currentCycle } = useSelectionStore();
  const { plateWells, setPlateData } = useDataStore();

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
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
    if (!sessionId || !currentCycle) {
      setStatus("loading");
      return;
    }
    setStatus((s) => (s === "ready" ? s : "loading"));
    setFetchError(null);
    try {
      const res = await getPlate(sessionId, currentCycle, useRox);
      setPlateData(res.wells);
      setStatus("ready");
    } catch (error) {
      console.error('Failed to fetch plate data:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
      setStatus("error");
    }
  }, [sessionId, currentCycle, useRox, setPlateData]);

  useEffect(() => {
    void fetchPlateData();
  }, [fetchPlateData, refetchTrigger]);

  const { plateRows, plateCols, isWellVisible } = useWellFilter();
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
  const getWellColor = (wellData: any): string => {
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
      return wellInfo(effectiveType, ploidy).color;
    }

    // Fall back to ratio gradient
    const ratio = wellData.ratio ?? 0.5;
    const r = Math.round(220 * (1 - ratio) + 37 * ratio);
    const g = Math.round(38 * (1 - ratio) + 99 * ratio);
    const b = Math.round(38 * (1 - ratio) + 235 * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Handle well click
  const handleWellClick = (wellId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    selectWell(wellId, 'plate');
  };

  // Handle drag start
  const handleMouseDown = (event: React.MouseEvent) => {
    // Only start drag if clicking on the panel background, not a well
    if ((event.target as HTMLElement).closest('.plate-well')) {
      return;
    }

    setDragStart({ x: event.clientX, y: event.clientY });
  };

  // Handle drag move
  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragStart) return;

    const deltaX = Math.abs(event.clientX - dragStart.x);
    const deltaY = Math.abs(event.clientY - dragStart.y);

    // Start dragging if moved beyond threshold
    if (!isDragging && (deltaX > dragThreshold || deltaY > dragThreshold)) {
      setIsDragging(true);
    }

    if (isDragging) {
      const left = Math.min(dragStart.x, event.clientX);
      const top = Math.min(dragStart.y, event.clientY);
      const width = Math.abs(event.clientX - dragStart.x);
      const height = Math.abs(event.clientY - dragStart.y);

      setDragRect({ left, top, width, height });
    }
  };

  // Handle drag end
  const handleMouseUp = (_event: React.MouseEvent) => {
    if (isDragging && dragRect && gridRef.current) {
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

      if (selectedWellIds.length > 0) {
        selectWells(selectedWellIds);
      }
    }

    // Reset drag state
    setIsDragging(false);
    setDragStart(null);
    setDragRect(null);
  };

  // Global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragStart(null);
      setDragRect(null);
    };

    if (isDragging) {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  // ── Keyboard grid navigation (roving tabindex, PRD FR-X-3) ─────────────────
  const wellBtnRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const [activeCell, setActiveCell] = useState({ r: 0, c: 0 });
  const anchorRef = useRef({ r: 0, c: 0 });

  const wellIdAt = (r: number, c: number) => `${plateRows[r]}${plateCols[c]}`;
  const focusCell = (r: number, c: number) => wellBtnRefs.current.get(wellIdAt(r, c))?.focus();

  // Toggle a set of wells: if all are already selected, remove them; else add.
  const toggleWells = (ids: string[]) => {
    if (ids.length === 0) return;
    const cur = new Set(selectedWells);
    const allSelected = ids.every((w) => cur.has(w));
    for (const w of ids) (allSelected ? cur.delete(w) : cur.add(w));
    const next = [...cur];
    if (next.length) selectWells(next);
    else clearSelection();
  };

  const rangeWells = (a: { r: number; c: number }, b: { r: number; c: number }) => {
    const [r0, r1] = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
    const [c0, c1] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
    const ids: string[] = [];
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const w = wellIdAt(r, c);
        if (wellMap.has(w)) ids.push(w);
      }
    return ids;
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const { r, c } = activeCell;
    const maxR = plateRows.length - 1;
    const maxC = plateCols.length - 1;
    let nr = r;
    let nc = c;
    switch (e.key) {
      case "ArrowUp": nr = Math.max(0, r - 1); break;
      case "ArrowDown": nr = Math.min(maxR, r + 1); break;
      case "ArrowLeft": nc = Math.max(0, c - 1); break;
      case "ArrowRight": nc = Math.min(maxC, c + 1); break;
      case "Home": nc = 0; break;
      case "End": nc = maxC; break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const w = wellIdAt(r, c);
        if (wellMap.has(w)) toggleWells([w]);
        return;
      }
      case "Escape": clearSelection(); return;
      default: return;
    }
    e.preventDefault();
    if (e.shiftKey && e.key.startsWith("Arrow")) {
      selectWells(rangeWells(anchorRef.current, { r: nr, c: nc }));
    } else {
      anchorRef.current = { r: nr, c: nc };
    }
    setActiveCell({ r: nr, c: nc });
    focusCell(nr, nc);
  };

  const toggleColumn = (c: number) =>
    toggleWells(plateRows.map((_, r) => wellIdAt(r, c)).filter((w) => wellMap.has(w)));
  const toggleRow = (r: number) =>
    toggleWells(plateCols.map((_, c) => wellIdAt(r, c)).filter((w) => wellMap.has(w)));

  return (
    <div
      className="panel plate-panel"
      ref={panelRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <h3 className="text-sm font-semibold mb-3 text-text">{t.plateView} ({plateRows.length}×{plateCols.length})</h3>

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

      <div style={{ overflowX: 'auto', display: status === "ready" && plateWells.length > 0 ? undefined : 'none' }}>
      <div
        id="plate-grid"
        role="grid"
        aria-label={t.plateGridAria}
        className="plate-grid select-none"
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        style={{
          display: 'grid',
          gridTemplateColumns: `auto repeat(${plateCols.length}, 1fr)`,
          gridTemplateRows: `auto repeat(${plateRows.length}, 1fr)`,
          gap: '2px',
          maxWidth: isLargePlate ? '820px' : '500px',
          margin: '0 auto'
        }}
      >
        {/* Corner cell */}
        <div className="plate-label" />

        {/* Column headers (click / Enter toggles the whole column) */}
        {plateCols.map((col, cIdx) => (
          <button
            key={`col-${col}`}
            type="button"
            tabIndex={-1}
            aria-label={t.toggleColumnAria(col)}
            onClick={() => toggleColumn(cIdx)}
            className="plate-label text-center text-text-muted font-medium py-1 bg-transparent border-none cursor-pointer hover:text-primary"
            style={{ fontSize: isLargePlate ? '0.6rem' : '0.75rem' }}
          >
            {col}
          </button>
        ))}

        {/* Rows with wells */}
        {plateRows.map((row, rIdx) => (
          <Fragment key={row}>
            {/* Row header (click / Enter toggles the whole row) */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={t.toggleRowAria(row)}
              onClick={() => toggleRow(rIdx)}
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
              const hasData = !!wellData;
              const isEmpty = !hasData;
              // Has data but excluded from plots (omitted, group-filtered, or hidden Empty)
              const isExcluded = hasData && !isWellVisible(wellId);
              const isActive = activeCell.r === rIdx && activeCell.c === cIdx;

              const wellColor = isEmpty ? '' : getWellColor(wellData);
              const cellSize = isLargePlate ? '18px' : '28px';

              const stateSuffix = isSelected || isMultiSelected
                ? `, ${t.wellSelectedState}`
                : isEmpty
                ? `, ${t.wellEmptyState}`
                : '';
              const ariaLabel = `${wellId}${wellData?.sample_name ? `, ${wellData.sample_name}` : ''}${stateSuffix}`;

              return (
                <button
                  key={wellId}
                  type="button"
                  role="gridcell"
                  data-well={wellId}
                  ref={(el) => { wellBtnRefs.current.set(wellId, el); }}
                  tabIndex={isActive ? 0 : -1}
                  aria-label={ariaLabel}
                  aria-pressed={isSelected || isMultiSelected}
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
                    ${isSelected ? 'selected ring-2 ring-primary ring-offset-1' : ''}
                    ${isMultiSelected && !isSelected ? 'ring-1 ring-primary/50' : ''}
                  `}
                  style={{
                    backgroundColor: wellColor || undefined,
                    minWidth: cellSize,
                    minHeight: cellSize,
                    aspectRatio: '1',
                  }}
                  onClick={(e) => {
                    setActiveCell({ r: rIdx, c: cIdx });
                    anchorRef.current = { r: rIdx, c: cIdx };
                    if (!isEmpty) handleWellClick(wellId, e);
                  }}
                  title={
                    wellData
                      ? `${wellId}: ${wellData.sample_name || 'No sample'}${isExcluded ? ' (excluded)' : ''}`
                      : wellId
                  }
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      </div>

      {/* Drag selection rectangle */}
      {isDragging && dragRect && (
        <div
          className="drag-selection-rect"
          style={{
            position: 'fixed',
            left: `${dragRect.left}px`,
            top: `${dragRect.top}px`,
            width: `${dragRect.width}px`,
            height: `${dragRect.height}px`,
            border: '2px solid var(--color-primary)',
            background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
            pointerEvents: 'none',
            zIndex: 50,
            borderRadius: '4px'
          }}
        />
      )}
    </div>
  );
}

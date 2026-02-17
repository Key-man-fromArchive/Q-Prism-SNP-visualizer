// @TASK Frontend - Plate View Component
// @SPEC Renders 96-well plate grid with drag selection and genotype coloring

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';
import { getPlate } from '@/lib/api';
import { PLATE_ROWS, PLATE_COLS, WELL_TYPE_INFO } from '@/lib/constants';

interface DragRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function PlateView() {
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Stores
  const sessionId = useSessionStore((s) => s.sessionId);
  const { showManualTypes, showAutoCluster } = useSettingsStore();
  const useRox = useSettingsStore((s) => s.useRox);
  const { selectedWell, selectedWells, selectWell, selectWells, currentCycle } = useSelectionStore();
  const { plateWells, setPlateData } = useDataStore();

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const dragThreshold = 5;

  // Fetch plate data when dependencies change
  useEffect(() => {
    if (!sessionId || currentCycle === undefined) return;

    const fetchPlateData = async () => {
      try {
        const res = await getPlate(sessionId, currentCycle, useRox);
        setPlateData(res.wells);
      } catch (error) {
        console.error('Failed to fetch plate data:', error);
      }
    };

    fetchPlateData();
  }, [sessionId, currentCycle, useRox, setPlateData]);

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

    // Use type color if available
    if (effectiveType !== null && WELL_TYPE_INFO[effectiveType as keyof typeof WELL_TYPE_INFO]) {
      return WELL_TYPE_INFO[effectiveType as keyof typeof WELL_TYPE_INFO].color;
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

  return (
    <div
      className="panel plate-panel"
      ref={panelRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <h3 className="text-sm font-semibold mb-3 text-text">Plate View (96-well)</h3>

      <div
        id="plate-grid"
        className="plate-grid select-none"
        ref={gridRef}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto repeat(12, 1fr)',
          gridTemplateRows: 'auto repeat(8, 1fr)',
          gap: '2px',
          maxWidth: '500px',
          margin: '0 auto'
        }}
      >
        {/* Corner cell */}
        <div className="plate-label" />

        {/* Column headers */}
        {PLATE_COLS.map(col => (
          <div
            key={`col-${col}`}
            className="plate-label text-center text-xs text-text-muted font-medium py-1"
          >
            {col}
          </div>
        ))}

        {/* Rows with wells */}
        {PLATE_ROWS.map(row => (
          <Fragment key={row}>
            {/* Row header */}
            <div className="plate-label text-center text-xs text-text-muted font-medium px-2">
              {row}
            </div>

            {/* Wells in this row */}
            {PLATE_COLS.map(col => {
              const wellId = `${row}${col}`;
              const wellData = wellMap.get(wellId);
              const isSelected = selectedWell === wellId;
              const isMultiSelected = selectedWells.includes(wellId);
              const isEmpty = !wellData;

              const wellColor = isEmpty ? '' : getWellColor(wellData);

              return (
                <div
                  key={wellId}
                  data-well={wellId}
                  className={`
                    plate-well
                    rounded
                    cursor-pointer
                    transition-all
                    duration-200
                    ${isEmpty ? 'empty bg-gray-800 opacity-30' : ''}
                    ${isSelected ? 'selected ring-2 ring-black dark:ring-white ring-offset-1' : ''}
                    ${isMultiSelected && !isSelected ? 'ring-1 ring-white/40' : ''}
                  `}
                  style={{
                    backgroundColor: wellColor || undefined,
                    minWidth: '28px',
                    minHeight: '28px',
                    aspectRatio: '1',
                  }}
                  onClick={(e) => !isEmpty && handleWellClick(wellId, e)}
                  title={wellData ? `${wellId}: ${wellData.sample_name || 'No sample'}` : wellId}
                />
              );
            })}
          </Fragment>
        ))}
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
            border: '2px solid #2563eb',
            background: 'rgba(37, 99, 235, 0.1)',
            pointerEvents: 'none',
            zIndex: 50,
            borderRadius: '4px'
          }}
        />
      )}
    </div>
  );
}

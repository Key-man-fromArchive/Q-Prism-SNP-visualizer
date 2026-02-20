import { useState, useCallback, useEffect, useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { setWellTypes, getWellGroups } from "@/lib/api";
import { CycleControl } from "./CycleControl";
import { ScatterPlot } from "./ScatterPlot";
import { PlateView } from "./PlateView";
import { WellDetailPanel } from "./WellDetailPanel";
import { ResultsTable } from "./ResultsTable";
import { AmplificationOverlay } from "./AmplificationOverlay";
import { WellTypePopup } from "./WellTypePopup";
import { GroupManager } from "./GroupManager";

export function AnalysisTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const wellGroups = useSessionStore((s) => s.wellGroups);
  const setWellGroups = useSessionStore((s) => s.setWellGroups);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const selectedGroup = useSelectionStore((s) => s.selectedGroup);
  const setGroup = useSelectionStore((s) => s.setGroup);
  const { showEmptyWells, setShowEmptyWells } = useSettingsStore();
  const wellTypeAssignments = useDataStore((s) => s.wellTypeAssignments);

  const [showGroupManager, setShowGroupManager] = useState(false);

  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [popupWells, setPopupWells] = useState<string[]>([]);

  // Show popup when multiple wells are selected (right-click or multi-select)
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const wells = useSelectionStore.getState().selectedWells;
      if (wells.length > 0) {
        e.preventDefault();
        setPopupPos({ x: e.clientX, y: e.clientY });
        setPopupWells(wells);
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Auto-show popup on multi-select (more than 1 well selected via drag)
  useEffect(() => {
    if (selectedWells.length > 1) {
      // Position popup near center of viewport
      setPopupPos({
        x: window.innerWidth / 2 - 90,
        y: window.innerHeight / 2 - 150,
      });
      setPopupWells(selectedWells);
    }
  }, [selectedWells]);

  const handleAssignType = useCallback(
    async (wellType: string) => {
      if (!sessionId || popupWells.length === 0) return;
      try {
        await setWellTypes(sessionId, { wells: popupWells, well_type: wellType as any });
        window.dispatchEvent(new CustomEvent("welltypes-changed"));
      } catch (err) {
        console.error("Failed to assign well type:", err);
      }
      setPopupPos(null);
      setPopupWells([]);
      clearSelection();
    },
    [sessionId, popupWells, clearSelection]
  );

  const handleClosePopup = useCallback(() => {
    setPopupPos(null);
    setPopupWells([]);
  }, []);

  // Fetch merged well groups (parsed + manual) when session changes
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const res = await getWellGroups(sessionId);
        const merged: Record<string, string[]> = {};
        for (const [name, info] of Object.entries(res.groups)) {
          merged[name] = info.wells;
        }
        if (Object.keys(merged).length > 0) {
          setWellGroups(merged);
        }
      } catch {
        // groups endpoint may not exist yet on old data
      }
    })();
  }, [sessionId, setWellGroups]);

  // Check if any wells are typed as Empty
  const hasEmptyWells = useMemo(
    () => Object.values(wellTypeAssignments).some((t) => t === "Empty"),
    [wellTypeAssignments]
  );

  // Group names for dropdown
  const groupNames = useMemo(
    () => (wellGroups ? Object.keys(wellGroups) : []),
    [wellGroups]
  );

  const totalWells = useMemo(() => {
    if (!wellGroups) return 0;
    const all = new Set<string>();
    for (const wells of Object.values(wellGroups)) {
      for (const w of wells) all.add(w);
    }
    return all.size;
  }, [wellGroups]);

  return (
    <div>
      {/* Cycle Control */}
      <CycleControl />

      {/* Group Filter Bar */}
      {(groupNames.length > 0 || hasEmptyWells) && (
        <div
          className="flex items-center gap-3 px-6 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {groupNames.length > 0 && (
            <>
              <label className="text-xs text-text-muted font-medium">Group:</label>
              <select
                className="px-2 py-1 border border-border rounded text-xs bg-surface text-text"
                value={selectedGroup || ""}
                onChange={(e) => setGroup(e.target.value || null)}
              >
                <option value="">All Wells ({totalWells})</option>
                {groupNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({wellGroups![name].length})
                  </option>
                ))}
              </select>
              <button
                className="text-xs px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg cursor-pointer"
                onClick={() => setShowGroupManager(true)}
                title="Manage groups"
              >
                +
              </button>
            </>
          )}
          {!groupNames.length && (
            <button
              className="text-xs px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg cursor-pointer"
              onClick={() => setShowGroupManager(true)}
              title="Create well groups"
            >
              + Group
            </button>
          )}
          {hasEmptyWells && (
            <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={showEmptyWells}
                onChange={(e) => setShowEmptyWells(e.target.checked)}
              />
              Show Empty
            </label>
          )}
        </div>
      )}

      {/* Analysis Grid - 2x2 layout */}
      <div
        className="analysis-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          padding: "16px 24px",
        }}
      >
        {/* Scatter Plot - top left */}
        <ScatterPlot />

        {/* Plate View - top right */}
        <PlateView />

        {/* Well Detail - bottom left */}
        <WellDetailPanel />

        {/* Results Table - bottom right */}
        <ResultsTable />
      </div>

      {/* Amplification Overlay - full width below grid */}
      <div style={{ padding: "0 24px 16px" }}>
        <AmplificationOverlay />
      </div>

      {/* Well Type Popup */}
      {popupPos && popupWells.length > 0 && (
        <WellTypePopup
          wells={popupWells}
          position={popupPos}
          onAssign={handleAssignType}
          onClose={handleClosePopup}
        />
      )}

      {/* Group Manager Dialog */}
      {showGroupManager && sessionId && (
        <GroupManager
          sessionId={sessionId}
          onClose={() => setShowGroupManager(false)}
        />
      )}
    </div>
  );
}

import { useState, useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { setWellTypes } from "@/lib/api";
import { CycleControl } from "./CycleControl";
import { ScatterPlot } from "./ScatterPlot";
import { PlateView } from "./PlateView";
import { WellDetailPanel } from "./WellDetailPanel";
import { ResultsTable } from "./ResultsTable";
import { AmplificationOverlay } from "./AmplificationOverlay";
import { WellTypePopup } from "./WellTypePopup";

export function AnalysisTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [popupWells, setPopupWells] = useState<string[]>([]);

  const handleAssignType = useCallback(
    async (wellType: string) => {
      if (!sessionId || popupWells.length === 0) return;
      try {
        await setWellTypes(sessionId, { wells: popupWells, well_type: wellType as any });
        // Trigger re-fetch by clearing popup (scatter/plate will re-fetch on data change)
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

  return (
    <div>
      {/* Cycle Control */}
      <CycleControl />

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
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { setWellTypes } from "@/lib/api";
import { Header } from "@/components/layout/Header";
import { UploadZone } from "@/components/upload/UploadZone";
import { TabNavigation, type TabId } from "@/components/layout/TabNavigation";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { AnalysisTab } from "@/components/analysis/AnalysisTab";
import { ProtocolTab } from "@/components/protocol/ProtocolTab";
import { QualityTab } from "@/components/quality/QualityTab";
import { StatisticsTab } from "@/components/statistics/StatisticsTab";
import { CompareTab } from "@/components/compare/CompareTab";
import { BatchTab } from "@/components/batch/BatchTab";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useExports } from "@/hooks/use-exports";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { KeyboardHelpOverlay } from "@/components/shared/KeyboardHelpOverlay";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analysis");

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const setUseRox = useSettingsStore((s) => s.setUseRox);
  const { toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV } = useExports();
  const { undo, redo } = useUndoRedo();

  // Track whether ROX was auto-set for THIS session (prevents overriding manual toggles)
  const roxAutoSetForSession = useRef<string | null>(null);

  // Auto-set ROX based on instrument ONLY on session change
  useEffect(() => {
    if (!sessionInfo || !sessionId) return;
    if (roxAutoSetForSession.current === sessionId) return;

    roxAutoSetForSession.current = sessionId;
    const instrument = (sessionInfo.instrument || "").toLowerCase();
    const isQuantStudio = instrument.includes("quantstudio");

    if (isQuantStudio && sessionInfo.has_rox) {
      setUseRox(true);
    } else if (!isQuantStudio) {
      setUseRox(false);
    }
  }, [sessionId, sessionInfo, setUseRox]);

  // Keyboard shortcut callbacks
  const shortcuts = useMemo(
    () => ({
      togglePlay: () => {
        const store = useSelectionStore.getState();
        store.setPlaying(!store.isPlaying);
      },
      prevCycle: () => {
        const store = useSelectionStore.getState();
        if (store.currentCycle > 1) store.setCycle(store.currentCycle - 1);
      },
      nextCycle: () => {
        const store = useSelectionStore.getState();
        store.setCycle(store.currentCycle + 1);
      },
      exportCSV: downloadCSV,
      toggleDarkMode,
      undo,
      redo,
      assignWellType: async (type: string) => {
        const sid = useSessionStore.getState().sessionId;
        const wells = useSelectionStore.getState().selectedWells;
        if (!sid || wells.length === 0) return;
        try {
          await setWellTypes(sid, { wells, well_type: type as any });
          useSelectionStore.getState().clearSelection();
          window.dispatchEvent(new CustomEvent("welltypes-changed"));
        } catch (err) {
          console.error("Failed to assign well type:", err);
        }
      },
    }),
    [downloadCSV, toggleDarkMode, undo, redo]
  );

  const { showHelp, setShowHelp } = useKeyboardShortcuts(shortcuts);

  // Project tab is accessible without a session
  const showProjectOnly = !sessionId && activeTab === "project";

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main>
        {!sessionId && !showProjectOnly && <UploadZone onGoToProject={() => setActiveTab("project")} />}

        {/* Session-dependent tabs */}
        <div id="analysis-panel" className={!sessionId && !showProjectOnly ? "hidden" : ""}>
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} hasSession={!!sessionId} />

          {sessionId && activeTab === "analysis" && <AnalysisTab />}
          {sessionId && activeTab === "protocol" && <ProtocolTab />}
          {sessionId && activeTab === "settings" && <SettingsTab />}
          {sessionId && activeTab === "quality" && <QualityTab />}
          {sessionId && activeTab === "statistics" && <StatisticsTab />}
          {sessionId && activeTab === "compare" && <CompareTab />}
          {activeTab === "project" && (
            <BatchTab onLoadSession={() => setActiveTab("analysis")} />
          )}
        </div>
      </main>

      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

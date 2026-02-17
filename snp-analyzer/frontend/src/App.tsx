import { useMemo, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
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
    }),
    [downloadCSV, toggleDarkMode, undo, redo]
  );

  const { showHelp, setShowHelp } = useKeyboardShortcuts(shortcuts);

  // Auto-set ROX based on instrument when session loads
  if (sessionInfo && sessionId) {
    const instrument = (sessionInfo.instrument || "").toLowerCase();
    const currentRox = useSettingsStore.getState().useRox;
    const isQuantStudio = instrument.includes("quantstudio");
    if (isQuantStudio && sessionInfo.has_rox && !currentRox) {
      setUseRox(true);
    } else if (!isQuantStudio && currentRox) {
      setUseRox(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main>
        {!sessionId ? (
          <UploadZone />
        ) : (
          <div id="analysis-panel">
            <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

            {activeTab === "analysis" && <AnalysisTab />}
            {activeTab === "protocol" && <ProtocolTab />}
            {activeTab === "settings" && <SettingsTab />}
            {activeTab === "quality" && <QualityTab />}
            {activeTab === "statistics" && <StatisticsTab />}
            {activeTab === "compare" && <CompareTab />}
            {activeTab === "batch" && <BatchTab />}
          </div>
        )}
      </main>

      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

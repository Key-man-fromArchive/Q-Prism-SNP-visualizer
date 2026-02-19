import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAuthStore } from "@/stores/auth-store";
import { setWellTypes, getMe } from "@/lib/api";
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
import { UserManagement } from "@/components/admin/UserManagement";
import { LoginPage } from "@/components/auth/LoginPage";
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

  // Auth state
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  // Check auth on mount
  useEffect(() => {
    getMe()
      .then((res) => setUser(res.user))
      .catch(() => clearAuth());
  }, [setUser, clearAuth]);

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

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Project tab is accessible without a session
  const showProjectOnly = !sessionId && (activeTab === "project" || activeTab === "users");
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main>
        {!sessionId && !showProjectOnly && <UploadZone onGoToProject={() => setActiveTab("project")} />}

        {/* Session-dependent tabs */}
        <div id="analysis-panel" className={!sessionId && !showProjectOnly ? "hidden" : ""}>
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} hasSession={!!sessionId} isAdmin={isAdmin} />

          {sessionId && activeTab === "analysis" && <AnalysisTab />}
          {sessionId && activeTab === "protocol" && <ProtocolTab />}
          {sessionId && activeTab === "settings" && <SettingsTab />}
          {sessionId && activeTab === "quality" && <QualityTab />}
          {sessionId && activeTab === "statistics" && <StatisticsTab />}
          {sessionId && activeTab === "compare" && <CompareTab />}
          {activeTab === "project" && (
            <BatchTab onLoadSession={() => setActiveTab("analysis")} />
          )}
          {activeTab === "users" && isAdmin && <UserManagement />}
        </div>
      </main>

      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}

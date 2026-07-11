import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAuthStore } from "@/stores/auth-store";
import { asgLaunch, asgLaunchCookie, getAuthConfig, setWellTypes, getMe } from "@/lib/api";
import { Header } from "@/components/layout/Header";
import { UploadZone } from "@/components/upload/UploadZone";
import { TabNavigation, type TabId } from "@/components/layout/TabNavigation";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
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
import { useI18n } from "@/hooks/use-i18n";
import type { WellType } from "@/types/api";
import { KeyboardHelpOverlay } from "@/components/shared/KeyboardHelpOverlay";

const ASG_LAUNCH_TOKEN_STORAGE_KEY = "__asg_launch_token";

declare global {
  interface Window {
    __ASG_LAUNCH_TOKEN__?: string;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analysis");

  const sessionId = useSessionStore((s) => s.sessionId);
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const setUseRox = useSettingsStore((s) => s.setUseRox);
  const { toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV } = useExports();
  const { undo, redo } = useUndoRedo();
  const { t } = useI18n();

  // Auth state
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setUser = useAuthStore((s) => s.setUser);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const setLinkedContext = useAuthStore((s) => s.setLinkedContext);
  const setLoading = useAuthStore((s) => s.setLoading);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const authMode = useAuthStore((s) => s.authMode);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [asgHomeUrl, setAsgHomeUrl] = useState<string>("/");

  // Check auth or exchange a one-time ASG launch token on mount.
  useEffect(() => {
    const run = async () => {
      const launchToken = consumeLaunchToken();
      try {
        const config = await getAuthConfig();
        setAuthMode(config.auth_mode);
        if (config.asg_home_url) setAsgHomeUrl(config.asg_home_url);

        if (config.auth_mode === "asg_launch" && launchToken) {
          const res = await asgLaunch(launchToken);
          setUser(res.user);
          setLinkedContext(res.linked_context);
          return;
        }

        if (config.auth_mode === "asg_launch") {
          try {
            const res = await asgLaunchCookie();
            setUser(res.user);
            setLinkedContext(res.linked_context);
            return;
          } catch {
            // No pending launch cookie; continue with any existing SNP auth cookie.
          }
        }

        const res = await getMe();
        setUser(res.user);
        setLinkedContext(res.linked_context ?? null);
      } catch (err) {
        clearAuth();
        if (launchToken) {
          setLaunchError(err instanceof Error ? err.message : "ASG launch failed");
        }
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [setUser, setAuthMode, setLinkedContext, setLoading, clearAuth]);

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
          await setWellTypes(sid, { wells, well_type: type as WellType });
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
        <p className="text-text-muted">{t.loading}</p>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    if (authMode === "asg_launch") {
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-lg font-semibold text-text mb-2">{t.asgLaunchTitle}</h1>
            <p className="text-sm text-text-muted mb-1">{t.asgLaunchMessage}</p>
            <p className="text-xs text-text-muted mb-4">{t.asgLaunchExpiredNote}</p>
            {launchError && <p className="text-xs text-danger mb-4">{launchError}</p>}
            <a
              href={asgHomeUrl}
              className="inline-block px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary-hover"
            >
              {t.backToAsgDesigner}
            </a>
          </div>
        </div>
      );
    }
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

          {/* Keep Analysis mounted across tab switches so the analysed cycle,
              clustering and view state persist (and it isn't re-initialised to
              the amplification default when you return). AnalysisWorkspace is
              the P4 2-surface shell (Plate Setup / Analysis) wrapping the
              existing AnalysisTab. */}
          {sessionId && (
            <div className={activeTab === "analysis" ? "" : "hidden"}>
              <AnalysisWorkspace />
            </div>
          )}
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

function readLaunchTokenFromUrl(): string | null {
  const queryToken = new URLSearchParams(window.location.search).get("token");
  if (queryToken) return queryToken;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(hash).get("token");
}

function consumeLaunchToken(): string | null {
  const urlToken = readLaunchTokenFromUrl();
  if (urlToken) {
    removeLaunchTokenFromUrl();
    return urlToken;
  }

  try {
    const storedToken = window.sessionStorage.getItem(ASG_LAUNCH_TOKEN_STORAGE_KEY);
    if (storedToken) {
      window.sessionStorage.removeItem(ASG_LAUNCH_TOKEN_STORAGE_KEY);
      return storedToken;
    }
  } catch {
    // sessionStorage may be unavailable in restricted browser contexts.
  }

  const fallbackToken = window.__ASG_LAUNCH_TOKEN__ ?? null;
  delete window.__ASG_LAUNCH_TOKEN__;
  return fallbackToken;
}

function removeLaunchTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("token");
  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    hashParams.delete("token");
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  }
  window.history.replaceState({}, document.title, url.toString());
}

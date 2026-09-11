import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { undoManual, redoManual } from "@/lib/manual-commands";
import { useSelectionStore } from "@/stores/selection-store";
import { useAuthStore } from "@/stores/auth-store";
import { bootstrapAuth } from '@/lib/auth-bootstrap';
import { Header } from "@/components/layout/Header";
import { UploadZone } from "@/components/upload/UploadZone";
import { TabNavigation } from "@/components/layout/TabNavigation";
import { QualityNavigationNotice } from '@/components/shared/QualityNavigationNotice';
import { useNavigationStore } from "@/stores/navigation-store";
import { connectAnalysisProjection } from "@/lib/analysis-projection";
import { SettingsTab } from "@/components/settings/SettingsTab";
import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { ProtocolTab } from "@/components/protocol/ProtocolTab";
import { QualityTab } from "@/components/quality/QualityTab";
import { StatisticsTab } from "@/components/statistics/StatisticsTab";
import { CompareTab } from "@/components/compare/CompareTab";
import { BatchTab } from "@/components/batch/BatchTab";
import { UserManagement } from "@/components/admin/UserManagement";
import { ReferencesTab } from "@/components/references/ReferencesTab";
import { LibraryTab } from "@/components/library/LibraryTab";
import { LoginPage } from "@/components/auth/LoginPage";
import { FeedbackAdminPanel } from "@/components/feedback/FeedbackAdminPanel";
import { FeedbackWidget } from "@/components/feedback/FeedbackWidget";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { adjacentCycle } from "@/lib/keyboard-routing";
import { keyboardCanExecute } from "@/lib/keyboard-authority";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useI18n } from "@/hooks/use-i18n";
import { useKeyboardAssignment } from "@/hooks/use-keyboard-assignment";
import { KeyboardHelpOverlay } from "@/components/shared/KeyboardHelpOverlay";
import { useWorkspaceLocation } from '@/hooks/use-workspace-location';
import { WorkspaceRestoreNotice } from '@/components/shared/WorkspaceRestoreNotice';

const ASG_LAUNCH_TOKEN_STORAGE_KEY = "__asg_launch_token";

function workspaceVisibility(ready: boolean, session: string | null, projectOnly: boolean) {
  return { upload: ready && !session && !projectOnly, panels: ready && Boolean(session || projectOnly) };
}

declare global {
  interface Window {
    __ASG_LAUNCH_TOKEN__?: string;
  }
}

export default function App() {
  const activeTab = useNavigationStore(state => state.tab);
  const workspaceReady = useNavigationStore(state => state.status === 'ready');
  const setActiveTab = useNavigationStore(state => state.setTab);
  useEffect(connectAnalysisProjection, []);

  const sessionId = useSessionStore((s) => s.sessionId);
  useWorkspaceLocation();
  const { toggle: toggleDarkMode } = useDarkMode();
  const { t } = useI18n();
  const { assign, message: keyboardMessage } = useKeyboardAssignment();

  // Auth state
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setUser = useAuthStore((s) => s.setUser);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const setLinkedContext = useAuthStore((s) => s.setLinkedContext);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const authMode = useAuthStore((s) => s.authMode);
  const [launchError, setLaunchError] = useState(false);
  const [asgHomeUrl, setAsgHomeUrl] = useState<string>("/");

  const bootstrap = useRef<{ generation: number; promise: ReturnType<typeof bootstrapAuth> } | null>(null);
  // StrictMode replay shares the exchange; logout/user changes invalidate every subscriber.
  useEffect(() => {
    let cancelled = false;
    bootstrap.current ??= { generation: useAuthStore.getState().generation, promise: bootstrapAuth(consumeLaunchToken()) };
    const request = bootstrap.current;
    void request.promise.then(({ config, login, launchFailed }) => {
      if (cancelled || useAuthStore.getState().generation !== request.generation) return;
      setAuthMode(config.auth_mode);
      if (config.asg_home_url) setAsgHomeUrl(config.asg_home_url);
      if (login) { setUser(login.user); setLinkedContext(login.linked_context ?? null); }
      else { clearAuth(); setLaunchError(launchFailed); }
    });
    return () => { cancelled = true; };
  }, [setUser, setAuthMode, setLinkedContext, clearAuth]);

  // ROX defaults are applied with the other restored settings at the ready barrier.

  // Keyboard shortcut callbacks
  const shortcuts = useMemo(
    () => ({
      canExecute: keyboardCanExecute,
      togglePlay: () => {
        const store = useSelectionStore.getState();
        store.setPlaying(!store.isPlaying);
      },
      prevCycle: () => {
        const store = useSelectionStore.getState();
        const cycle = adjacentCycle(useNavigationStore.getState().availableCycles, store.currentCycle, -1);
        if (cycle !== null) store.setCycle(cycle);
      },
      nextCycle: () => {
        const store = useSelectionStore.getState();
        const cycle = adjacentCycle(useNavigationStore.getState().availableCycles, store.currentCycle, 1);
        if (cycle !== null) store.setCycle(cycle);
      },
      exportCSV: () => window.dispatchEvent(new CustomEvent('keyboard-export-csv')),
      toggleDarkMode,
      assignWellType: assign,
      undo: undoManual,
      redo: redoManual,
    }),
    [toggleDarkMode, assign]
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
            {launchError && <p className="text-xs text-danger mb-4">{t.restoreLaunchFailed}</p>}
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

  // Project/References/Users/Library tabs are accessible without a session
  const showProjectOnly =
    !sessionId &&
    (activeTab === "project" ||
      activeTab === "users" ||
      activeTab === "references" ||
      activeTab === "library" ||
      activeTab === "feedback");
  const isAdmin = user?.role === "admin";
  const visibility = workspaceVisibility(workspaceReady, sessionId, showProjectOnly);

  return (
    <div className="min-h-screen bg-bg">
      <Header />
      <main>
        <WorkspaceRestoreNotice />
        {visibility.upload && <UploadZone onGoToProject={() => setActiveTab("project")} />}

        {/* Session-dependent tabs */}
        <div id="analysis-panel" className={visibility.panels ? "" : "hidden"}>
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} hasSession={!!sessionId} isAdmin={isAdmin} />
          <QualityNavigationNotice />

          {/* Keep Analysis mounted across tab switches so the analysed cycle,
              clustering and view state persist (and it isn't re-initialised to
              the amplification default when you return). AnalysisWorkspace is
              the P4 2-surface shell (Plate Setup / Analysis) wrapping the
              existing AnalysisTab. */}
          {sessionId && (
            <div id="main-panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" className={activeTab === "analysis" ? "" : "hidden"}>
              <AnalysisWorkspace />
            </div>
          )}
          {!sessionId && <div id="main-panel-analysis" role="tabpanel" aria-labelledby="tab-analysis" hidden />}
          <div id={activeTab === 'analysis' ? undefined : `main-panel-${activeTab}`} role={['analysis', 'references', 'users'].includes(activeTab) ? undefined : 'tabpanel'} aria-labelledby={['analysis', 'references', 'users'].includes(activeTab) ? undefined : `tab-${activeTab}`} hidden={activeTab === 'analysis'}>
          {sessionId && activeTab === "protocol" && <ProtocolTab />}
          {sessionId && activeTab === "settings" && <SettingsTab />}
          {sessionId && activeTab === "quality" && <QualityTab />}
          {sessionId && activeTab === "statistics" && <StatisticsTab />}
          {sessionId && activeTab === "compare" && <CompareTab />}
          {activeTab === "project" && (
            <BatchTab onLoadSession={() => setActiveTab("analysis")} />
          )}
          {activeTab === "users" && isAdmin && <UserManagement />}
          {activeTab === "references" && <ReferencesTab />}
          {activeTab === "library" && <LibraryTab />}
          {activeTab === "feedback" && isAdmin && <FeedbackAdminPanel />}
          </div>
          {['protocol', 'settings', 'quality', 'statistics', 'compare', 'project', 'library'].filter(tab => tab !== activeTab).map(tab =>
            <div key={tab} id={`main-panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} hidden />)}
        </div>
      </main>

      {showHelp && <KeyboardHelpOverlay onClose={() => setShowHelp(false)} />}
      <p role="status" aria-live="polite" className="sr-only">{keyboardMessage}</p>

      {/* Every authenticated screen gets the feedback entry point; the tab the
          operator is on is recorded as the report's page_key (this is a
          tab-based SPA, so there is no route to read it from). */}
      <FeedbackWidget pageKey={activeTab} />
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
    if (hashParams.has('token')) {
      hashParams.delete("token");
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : "";
    }
  }
  window.history.replaceState({}, document.title, url.toString());
}

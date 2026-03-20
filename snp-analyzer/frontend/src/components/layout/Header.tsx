import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useAuthStore } from "@/stores/auth-store";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useExports } from "@/hooks/use-exports";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useI18n } from "@/hooks/use-i18n";
import { useLanguageStore } from "@/stores/language-store";
import { QcBadges } from "@/components/shared/QcBadges";
import { AddToProjectButton } from "@/components/analysis/AddToProjectButton";
import { logout } from "@/lib/api";

export function Header() {
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const sessionId = useSessionStore((s) => s.sessionId);
  const reset = useSessionStore((s) => s.reset);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV, exportPNG, exportPDF, printReport } = useExports();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  const { t } = useI18n();
  const { language, setLanguage } = useLanguageStore();

  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const handleNewUpload = () => {
    reset();
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Clear auth even if server call fails
    }
    clearAuth();
  };

  // Wrap export functions to show user-visible errors
  const safeExport = useCallback(
    (fn: () => Promise<void>, label: string) => async () => {
      try {
        await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        alert(t.exportFailed(label, msg));
      }
    },
    []
  );

  return (
    <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-4">
      <h1 className="text-lg font-semibold text-text">
        {t.appTitle}
      </h1>
      <a
        href="https://www.invirustech.com"
        target="_blank"
        rel="noopener"
        className="ml-auto text-xs text-text-muted border border-border rounded-xl px-2.5 py-0.5 hover:text-primary hover:border-primary transition-colors no-underline"
      >
        {t.poweredBy}
      </a>

      <div id="session-info" className={`flex gap-2 items-center ${!sessionInfo ? "hidden" : ""}`}>
        {sessionInfo && (
          <>
          <span id="instrument-badge" className="badge">
            {sessionInfo.instrument}
          </span>
          <span id="wells-badge" className="badge">
            {sessionInfo.num_wells} {t.wells}
          </span>
          <span id="cycles-badge" className="badge">
            {sessionInfo.num_cycles} {t.cycles}
          </span>
          <QcBadges />
          </>
        )}
      </div>

      {sessionId && (
        <div id="export-buttons" className="flex gap-1 ml-2">
          <button
            id="undo-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all disabled:opacity-40 disabled:cursor-default"
            title={t.undoTooltip}
            onClick={undo}
            disabled={!canUndo}
          >
            {t.undo}
          </button>
          <button
            id="redo-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all disabled:opacity-40 disabled:cursor-default"
            title={t.redoTooltip}
            onClick={redo}
            disabled={!canRedo}
          >
            {t.redo}
          </button>
          <span className="w-px bg-border mx-1" />
          <button
            id="export-csv-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title={t.exportCSVTooltip}
            onClick={safeExport(downloadCSV, t.csvExportFailed)}
          >
            {t.exportCSV}
          </button>
          <button
            id="export-png-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title={t.exportPNGTooltip}
            onClick={safeExport(exportPNG, t.pngExportFailed)}
          >
            {t.exportPNG}
          </button>
          <button
            id="export-print-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title={t.exportPrintTooltip}
            onClick={printReport}
          >
            {t.exportPrint}
          </button>
          <button
            id="export-pdf-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title={t.exportPDFTooltip}
            onClick={safeExport(exportPDF, t.pdfExportFailed)}
          >
            {t.exportPDF}
          </button>
          <button
            id="new-upload-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title={t.uploadAnother}
            onClick={handleNewUpload}
          >
            {t.newUpload}
          </button>
          <span className="w-px bg-border mx-1" />
          <AddToProjectButton />
        </div>
      )}

      {/* User info + Logout */}
      {user && (
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-text">{user.display_name || user.username}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
            user.role === 'admin'
              ? 'border-primary text-primary'
              : 'border-border text-text-muted'
          }`}>
            {user.role}
          </span>
          <button
            onClick={handleLogout}
            className="text-xs text-text-muted hover:text-red-500 cursor-pointer transition-colors"
            title={t.signOut}
          >
            {t.logout}
          </button>
        </div>
      )}

      <button
        onClick={() => setLanguage(language === 'en' ? 'ko' : 'en')}
        title={language === 'en' ? '한국어로 전환' : 'Switch to English'}
        className="bg-transparent border border-border rounded-full w-8 h-8 flex items-center justify-center cursor-pointer text-xs font-bold hover:bg-bg hover:border-primary transition-colors ml-2"
      >
        {language === 'en' ? '한' : 'EN'}
      </button>
      <button
        id="dark-mode-toggle"
        onClick={toggleDarkMode}
        title={isDark ? t.lightMode : t.darkMode}
        className="bg-transparent border border-border rounded-full w-8 h-8 flex items-center justify-center cursor-pointer text-base hover:bg-bg hover:border-primary transition-colors ml-2"
      >
        {isDark ? "\u2600\uFE0F" : "\uD83C\uDF19"}
      </button>
    </header>
  );
}

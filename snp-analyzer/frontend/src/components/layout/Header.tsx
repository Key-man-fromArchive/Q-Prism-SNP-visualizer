import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Download, Moon, Redo2, Save, Sun, Undo2 } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useExports } from "@/hooks/use-exports";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useI18n } from "@/hooks/use-i18n";
import { useLanguageStore } from "@/stores/language-store";
import { QcBadges } from "@/components/shared/QcBadges";
import { AddToProjectButton } from "@/components/analysis/AddToProjectButton";
import { Button, IconButton, Menu, type MenuItem } from "@/components/shared/ui";
import { logout, saveAsgResult } from "@/lib/api";

export function Header() {
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const sessionId = useSessionStore((s) => s.sessionId);
  const reset = useSessionStore((s) => s.reset);
  const currentCycle = useSelectionStore((s) => s.currentCycle);
  const useRox = useSettingsStore((s) => s.useRox);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV, exportPNG, exportPDF, exportXLSX, printReport } = useExports();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  const { t } = useI18n();
  const { language, setLanguage } = useLanguageStore();

  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const linkedContext = useAuthStore((s) => s.linkedContext);
  const canSaveToAsg = Boolean(linkedContext?.scope?.includes("snp:save_result"));
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [asgSaveState, setAsgSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [asgAnalysisId, setAsgAnalysisId] = useState<string | null>(null);
  const [asgSaveError, setAsgSaveError] = useState<string | null>(null);
  const asgSaveTitle = asgSaveError || asgAnalysisId || (
    canSaveToAsg ? "Save result to ASG Designer" : "Open from an ASG marker, design result, or order item to save"
  );
  const asgResultRevision = useRef(0);

  useEffect(() => {
    asgResultRevision.current += 1;
    setAsgSaveState("idle");
    setAsgAnalysisId(null);
    setAsgSaveError(null);
  }, [sessionId]);

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

  const handleAsgSave = async () => {
    if (!sessionId || !linkedContext || !canSaveToAsg) return;
    const saveRevision = asgResultRevision.current;
    setAsgSaveState("saving");
    setAsgSaveError(null);
    try {
      const result = await saveAsgResult(sessionId, currentCycle, useRox);
      if (saveRevision !== asgResultRevision.current) return;
      setAsgAnalysisId(result.analysis_run_id);
      setAsgSaveState("saved");
    } catch (err) {
      if (saveRevision !== asgResultRevision.current) return;
      const message = err instanceof Error ? err.message : "Failed to save ASG result";
      setAsgSaveError(message);
      setAsgSaveState("error");
    }
  };

  const markAsgResultDirty = useCallback(() => {
    asgResultRevision.current += 1;
    setAsgSaveState("idle");
    setAsgAnalysisId(null);
    setAsgSaveError(null);
  }, []);

  useEffect(() => {
    markAsgResultDirty();
  }, [currentCycle, useRox, markAsgResultDirty]);

  useEffect(() => {
    window.addEventListener("welltypes-changed", markAsgResultDirty);
    window.addEventListener("asg-result-dirty", markAsgResultDirty);
    return () => {
      window.removeEventListener("welltypes-changed", markAsgResultDirty);
      window.removeEventListener("asg-result-dirty", markAsgResultDirty);
    };
  }, [markAsgResultDirty]);

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
    [t]
  );

  const exportItems: MenuItem[] = [
    { key: "csv", label: t.exportCSV, onSelect: () => void safeExport(downloadCSV, t.csvExportFailed)() },
    { key: "png", label: t.exportPNG, onSelect: () => void safeExport(exportPNG, t.pngExportFailed)() },
    { key: "print", label: t.exportPrint, onSelect: () => void printReport() },
    { key: "pdf", label: t.exportPDF, onSelect: () => void safeExport(exportPDF, t.pdfExportFailed)() },
    { key: "xlsx", label: t.exportXLSX, onSelect: () => void safeExport(exportXLSX, t.xlsxExportFailed)() },
  ];

  return (
    <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-3">
      {/* Left region: brand + session context */}
      <h1 className="text-lg font-semibold text-text whitespace-nowrap">{t.appTitle}</h1>

      {linkedContext && (
        <div className="hidden lg:flex items-center gap-1 text-xs text-text-muted border border-border rounded px-2 py-1">
          <span>{linkedContext.target_type}</span>
          <span className="text-text">{linkedContext.target_id}</span>
          {typeof linkedContext.context.tag_alias === "string" && linkedContext.context.tag_alias && (
            <span className="badge">{linkedContext.context.tag_alias}</span>
          )}
          {typeof linkedContext.context.marker_id === "string" && (
            <span>{linkedContext.context.marker_id}</span>
          )}
        </div>
      )}

      {sessionInfo && (
        <div id="session-info" className="flex gap-2 items-center">
          <span id="instrument-badge" className="badge">{sessionInfo.instrument}</span>
          <span id="wells-badge" className="badge">{sessionInfo.num_wells} {t.wells}</span>
          <span id="cycles-badge" className="badge">{sessionInfo.num_cycles} {t.cycles}</span>
          <QcBadges />
        </div>
      )}

      {/* Right region: actions + user + locale + theme */}
      <div className="ml-auto flex items-center gap-2">
        <a
          href="https://www.invirustech.com"
          target="_blank"
          rel="noopener"
          className="hidden md:inline-block text-xs text-text-muted border border-border rounded-xl px-2.5 py-0.5 hover:text-primary hover:border-primary transition-colors no-underline"
        >
          {t.poweredBy}
        </a>

        {sessionId && (
          <div id="export-buttons" className="flex items-center gap-1">
            <IconButton size="sm" aria-label={t.undo} title={t.undoTooltip} onClick={undo} disabled={!canUndo}>
              <Undo2 size={16} aria-hidden="true" />
            </IconButton>
            <IconButton size="sm" aria-label={t.redo} title={t.redoTooltip} onClick={redo} disabled={!canRedo}>
              <Redo2 size={16} aria-hidden="true" />
            </IconButton>
            <Menu
              label={t.exportMenu}
              triggerClassName="px-2.5 py-1 text-xs"
              trigger={<><Download size={14} aria-hidden="true" /> {t.exportMenu}</>}
              items={exportItems}
            />
            <Button variant="secondary" size="sm" onClick={handleNewUpload} title={t.uploadAnother}>
              {t.newUpload}
            </Button>
            <AddToProjectButton />
            {authMode === "asg_launch" && (
              <Button
                id="asg-save-result-btn"
                variant="secondary"
                size="sm"
                title={asgSaveTitle}
                onClick={handleAsgSave}
                disabled={!canSaveToAsg || asgSaveState === "saving"}
              >
                {asgSaveState === "saved" ? (
                  <Check size={13} aria-hidden="true" />
                ) : asgSaveState === "error" ? (
                  <AlertCircle size={13} aria-hidden="true" />
                ) : (
                  <Save size={13} aria-hidden="true" />
                )}
                <span>{asgSaveState === "saving" ? "Saving" : asgSaveState === "saved" ? "Saved" : "ASG"}</span>
              </Button>
            )}
          </div>
        )}

        {user && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-text whitespace-nowrap">{user.display_name || user.username}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
              user.role === "admin" ? "border-primary text-primary" : "border-border text-text-muted"
            }`}>
              {user.role}
            </span>
            <button
              onClick={handleLogout}
              className="text-xs text-text-muted hover:text-danger cursor-pointer transition-colors"
              title={t.signOut}
            >
              {t.logout}
            </button>
          </div>
        )}

        <button
          onClick={() => setLanguage(language === "en" ? "ko" : "en")}
          title={language === "en" ? "한국어로 전환" : "Switch to English"}
          aria-label={language === "en" ? "한국어로 전환" : "Switch to English"}
          className="bg-transparent border border-border rounded-full w-8 h-8 flex items-center justify-center cursor-pointer text-xs font-bold text-text-muted hover:text-primary hover:border-primary transition-colors"
        >
          {language === "en" ? "한" : "EN"}
        </button>
        <IconButton
          id="dark-mode-toggle"
          aria-label={isDark ? t.lightMode : t.darkMode}
          title={isDark ? t.lightMode : t.darkMode}
          onClick={toggleDarkMode}
          className="border border-border rounded-full"
        >
          {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </IconButton>
      </div>
    </header>
  );
}

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { AlertCircle, Check, Download, Moon, Redo2, Save, Sun, Undo2 } from "lucide-react";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useNavigationStore } from "@/stores/navigation-store";
import { useAnalysisStore } from "@/stores/analysis-store";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useExports } from "@/hooks/use-exports";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useI18n } from "@/hooks/use-i18n";
import { useLanguageStore } from "@/stores/language-store";
import { QcBadges } from "@/components/shared/QcBadges";
import { AddToProjectButton } from "@/components/analysis/AddToProjectButton";
import { Button, IconButton, Menu, Modal, type MenuItem } from "@/components/shared/ui";
import { ApiError, logout, saveAsgResult } from "@/lib/api";
import { analyzeCurrent } from "@/lib/analysis-actions";
import { loadAnalysisSession } from "@/lib/analysis-session";

function useAsgSavePresentation(sessionId: string | null, currentCycle: number | null, useRox: boolean) {
  const [asgSaveState, setAsgSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [asgAnalysisId, setAsgAnalysisId] = useState<string | null>(null);
  const [asgSaveError, setAsgSaveError] = useState<string | null>(null);
  const [saveInputs, setSaveInputs] = useState({ sessionId, currentCycle, useRox });
  // Reset render-owned state before children commit a new result identity.
  if (saveInputs.sessionId !== sessionId || saveInputs.currentCycle !== currentCycle || saveInputs.useRox !== useRox) {
    setSaveInputs({ sessionId, currentCycle, useRox });
    setAsgSaveState("idle");
    setAsgAnalysisId(null);
    setAsgSaveError(null);
  }
  return { asgSaveState, setAsgSaveState, asgAnalysisId, setAsgAnalysisId, asgSaveError, setAsgSaveError };
}

export function Header() {
  type ExportKind = "csv" | "png" | "pdf" | "xlsx";
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const sessionId = useSessionStore((s) => s.sessionId);
  const reset = useSessionStore((s) => s.reset);
  const navigationCycle = useNavigationStore((s) => s.cycle);
  const legacyCycle = useSelectionStore((s) => s.currentCycle);
  const currentCycle = navigationCycle ?? legacyCycle;
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const resultRevision = useAnalysisStore((s) => s.result?.analysis_context?.result_revision);
  const analysisPending = useAnalysisStore((s) => s.pending);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV, exportPNG, exportPDF, exportXLSX, exportStored, printReport } = useExports();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  const { t } = useI18n();
  const { language, setLanguage } = useLanguageStore();

  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const linkedContext = useAuthStore((s) => s.linkedContext);
  const canSaveToAsg = Boolean(linkedContext?.scope?.includes("snp:save_result"));
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { asgSaveState, setAsgSaveState, asgAnalysisId, setAsgAnalysisId, asgSaveError, setAsgSaveError } = useAsgSavePresentation(sessionId, currentCycle, useRox);
  const asgSaveTitle = asgSaveError || asgAnalysisId || (
    canSaveToAsg ? "Save result to ASG Designer" : "Open from an ASG marker, design result, or order item to save"
  );
  const asgResultRevision = useRef(0);
  const mismatchToken = useRef(0);
  const mismatchAbort = useRef<AbortController | null>(null);
  const [exportMismatch, setExportMismatch] = useState<{
    kind: ExportKind; label: string; token: number; sessionId: string; entry: number; ownerId: string | undefined; revision: string | undefined;
  } | null>(null);
  const [mismatchBusy, setMismatchBusy] = useState(false);
  const closeMismatch = useCallback(() => { mismatchToken.current += 1; mismatchAbort.current?.abort(); mismatchAbort.current = null; setMismatchBusy(false); setExportMismatch(null); }, []);
  const openMismatch = useCallback((kind: ExportKind, label: string) => {
    const state = useAnalysisStore.getState();
    const token = mismatchToken.current + 1;
    mismatchToken.current = token;
    mismatchAbort.current?.abort();
    mismatchAbort.current = new AbortController();
    setExportMismatch({ kind, label, token, sessionId: useSessionStore.getState().sessionId ?? '',
      entry: useSessionStore.getState().entryGeneration, ownerId: useAuthStore.getState().user?.id,
      revision: state.result?.analysis_context?.result_revision });
  }, []);
  const ownsMismatch = useCallback((value: NonNullable<typeof exportMismatch>, allowRevised = false) =>
    mismatchToken.current === value.token && useSessionStore.getState().sessionId === value.sessionId
      && useSessionStore.getState().entryGeneration === value.entry
      && useAuthStore.getState().user?.id === value.ownerId
      && (allowRevised || useAnalysisStore.getState().result?.analysis_context?.result_revision === value.revision), []);

  useEffect(() => {
    asgResultRevision.current += 1;
  }, [sessionId, currentCycle, useRox, backgroundMode, resultRevision]);

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
      if (analysisPending) throw new Error("Wait for the active analysis before saving");
      // An absent store value occurs during the initial legacy-compatible shell;
      // a known legacy result is rejected server-side with structured 409.
      const result = await saveAsgResult(sessionId, currentCycle ?? undefined, useRox, backgroundMode, resultRevision);
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
  }, [setAsgSaveState, setAsgAnalysisId, setAsgSaveError]);

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
    (kind: ExportKind, fn: () => Promise<void>, label: string) => async () => {
      const origin = { sessionId: useSessionStore.getState().sessionId, entry: useSessionStore.getState().entryGeneration,
        ownerId: useAuthStore.getState().user?.id };
      const ownsOrigin = () => useSessionStore.getState().sessionId === origin.sessionId
        && useSessionStore.getState().entryGeneration === origin.entry && useAuthStore.getState().user?.id === origin.ownerId;
      try {
        await fn();
      } catch (err) {
        if (!ownsOrigin()) return;
        if (err instanceof ApiError && err.code === "EXPORT_CONDITION_MISMATCH") {
          openMismatch(kind, label);
          return;
        }
        if (err instanceof ApiError && err.code === "RESULT_REVISION_CONFLICT") {
          const refreshed = await loadAnalysisSession();
          if (refreshed) {
            openMismatch(kind, label);
            return;
          }
        }
        const msg = err instanceof Error ? err.message : "Unknown error";
        alert(t.exportFailed(label, msg));
      }
    },
    [t, openMismatch]
  );

  const exportItems: MenuItem[] = [
    { key: "csv", label: t.exportCSV, onSelect: () => void safeExport("csv", downloadCSV, t.csvExportFailed)() },
    { key: "png", label: t.exportPNG, onSelect: () => void safeExport("png", exportPNG, t.pngExportFailed)() },
    { key: "print", label: t.exportPrint, onSelect: () => void printReport() },
    { key: "pdf", label: t.exportPDF, onSelect: () => void safeExport("pdf", exportPDF, t.pdfExportFailed)() },
    { key: "xlsx", label: t.exportXLSX, onSelect: () => void safeExport("xlsx", exportXLSX, t.xlsxExportFailed)() },
  ];
  const keyboardExport = useEffectEvent(() => { void safeExport("csv", downloadCSV, t.csvExportFailed)(); });
  useEffect(() => {
    const listener = () => keyboardExport();
    window.addEventListener('keyboard-export-csv', listener);
    return () => window.removeEventListener('keyboard-export-csv', listener);
  }, []);

  const runMismatchReanalysis = async () => {
    const pendingMismatch = exportMismatch;
    const request = useAnalysisStore.getState().currentRequest;
    if (!pendingMismatch || !request || mismatchBusy || !ownsMismatch(pendingMismatch)) return;
    setMismatchBusy(true);
    const accepted = await analyzeCurrent(request);
    if (!accepted || !ownsMismatch(pendingMismatch, true)) { setMismatchBusy(false); return; }
    closeMismatch();
    const actions: Record<ExportKind, () => Promise<void>> = {
      csv: downloadCSV, png: exportPNG, pdf: exportPDF, xlsx: exportXLSX,
    };
    try { await actions[pendingMismatch.kind](); }
    catch (err) { alert(t.exportFailed(pendingMismatch.label, err instanceof Error ? err.message : "Unknown error")); }
  };

  const runStoredExport = async () => {
    const pendingMismatch = exportMismatch;
    if (!pendingMismatch || mismatchBusy || !ownsMismatch(pendingMismatch)) return;
    setMismatchBusy(true);
    try {
      await exportStored(pendingMismatch.kind, mismatchAbort.current?.signal);
      if (ownsMismatch(pendingMismatch)) closeMismatch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (ownsMismatch(pendingMismatch)) alert(t.exportFailed(pendingMismatch.label, message));
    } finally {
      if (ownsMismatch(pendingMismatch)) setMismatchBusy(false);
    }
  };

  return (
    <>
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
    <Modal
      open={exportMismatch !== null}
      onClose={closeMismatch}
      title={t.exportMismatchTitle}
      description={t.exportMismatchDescription}
      role="alertdialog"
      footer={<>
        <Button variant="secondary" onClick={closeMismatch}>{t.cancel}</Button>
        <Button variant="secondary" disabled={mismatchBusy} onClick={() => void runStoredExport()}>{t.exportStoredResult}</Button>
        <Button disabled={mismatchBusy} onClick={() => void runMismatchReanalysis()}>{t.exportReanalyzeCurrent}</Button>
      </>}
    />
    </>
  );
}

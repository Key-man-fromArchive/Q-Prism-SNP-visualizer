import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useExports } from "@/hooks/use-exports";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { QcBadges } from "@/components/shared/QcBadges";

export function Header() {
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const sessionId = useSessionStore((s) => s.sessionId);
  const reset = useSessionStore((s) => s.reset);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();
  const { downloadCSV, exportPNG, exportPDF, printReport } = useExports();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();

  const handleNewUpload = () => {
    reset();
  };

  // Wrap export functions to show user-visible errors
  const safeExport = useCallback(
    (fn: () => Promise<void>, label: string) => async () => {
      try {
        await fn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        alert(`${label} failed: ${msg}`);
      }
    },
    []
  );

  return (
    <header className="bg-surface border-b border-border px-6 py-3 flex items-center gap-4">
      <h1 className="text-lg font-semibold text-text">
        ASG-PCR SNP Discrimination Analyzer
      </h1>
      <a
        href="https://www.invirustech.com"
        target="_blank"
        rel="noopener"
        className="ml-auto text-xs text-text-muted border border-border rounded-xl px-2.5 py-0.5 hover:text-primary hover:border-primary transition-colors no-underline"
      >
        Powered by Invirustech
      </a>

      <div id="session-info" className={`flex gap-2 items-center ${!sessionInfo ? "hidden" : ""}`}>
        {sessionInfo && (
          <>
          <span id="instrument-badge" className="badge">
            {sessionInfo.instrument}
          </span>
          <span id="wells-badge" className="badge">
            {sessionInfo.num_wells} wells
          </span>
          <span id="cycles-badge" className="badge">
            {sessionInfo.num_cycles} cycles
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
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={!canUndo}
          >
            Undo
          </button>
          <button
            id="redo-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all disabled:opacity-40 disabled:cursor-default"
            title="Redo (Ctrl+Shift+Z)"
            onClick={redo}
            disabled={!canRedo}
          >
            Redo
          </button>
          <span className="w-px bg-border mx-1" />
          <button
            id="export-csv-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title="Export CSV (Ctrl+E)"
            onClick={safeExport(downloadCSV, "CSV export")}
          >
            CSV
          </button>
          <button
            id="export-png-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title="Export scatter PNG"
            onClick={safeExport(exportPNG, "PNG export")}
          >
            PNG
          </button>
          <button
            id="export-print-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title="Print report"
            onClick={printReport}
          >
            Print
          </button>
          <button
            id="export-pdf-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title="Export PDF report"
            onClick={safeExport(exportPDF, "PDF export")}
          >
            PDF
          </button>
          <button
            id="new-upload-btn"
            className="badge cursor-pointer hover:text-primary hover:border-primary transition-all"
            title="Upload another file"
            onClick={handleNewUpload}
          >
            + New
          </button>
        </div>
      )}

      <button
        id="dark-mode-toggle"
        onClick={toggleDarkMode}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className="bg-transparent border border-border rounded-full w-8 h-8 flex items-center justify-center cursor-pointer text-base hover:bg-bg hover:border-primary transition-colors ml-2"
      >
        {isDark ? "\u2600\uFE0F" : "\uD83C\uDF19"}
      </button>
    </header>
  );
}

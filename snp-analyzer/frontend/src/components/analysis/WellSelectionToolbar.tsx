import { Focus, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSelectionStore } from "@/stores/selection-store";

export function WellSelectionToolbar() {
  const { t } = useI18n();
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const focusSelectedWells = useSelectionStore((s) => s.focusSelectedWells);
  const setFocusSelectedWells = useSelectionStore((s) => s.setFocusSelectedWells);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const hasSelection = selectedWells.length > 0;

  return (
    <div
      data-testid="analysis-selection-toolbar"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg px-3 py-2"
    >
      <span className="text-xs text-text-muted">{t.selectionHelp}</span>
      <span
        data-testid="analysis-selection-count"
        className="ml-auto rounded-full bg-surface px-2 py-1 text-xs font-semibold text-text"
      >
        {t.selectedWellCount(selectedWells.length)}
      </span>
      <button
        type="button"
        data-testid="scatter-selected-only"
        aria-pressed={focusSelectedWells}
        disabled={!hasSelection}
        onClick={() => setFocusSelectedWells(!focusSelectedWells)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
          focusSelectedWells
            ? "border-primary bg-primary text-white"
            : "border-border bg-surface text-text hover:border-primary"
        }`}
      >
        {focusSelectedWells ? <RotateCcw size={13} /> : <Focus size={13} />}
        {focusSelectedWells ? t.showAllScatterWells : t.showSelectedScatterWells}
      </button>
      {hasSelection && (
        <button
          type="button"
          onClick={clearSelection}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted hover:bg-surface hover:text-text"
        >
          <X size={13} /> {t.clearWellSelection}
        </button>
      )}
    </div>
  );
}

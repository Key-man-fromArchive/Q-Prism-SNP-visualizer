import { useEffect, useMemo, useState } from "react";
import { Check, Focus, Plus, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { createWellGroup, getWellGroups } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";

const DEFAULT_GROUPS = Array.from({ length: 6 }, (_, i) => `Group ${i + 1}`);

export type WellSelectionToolbarProps = {
  /** Parsed/manual group filter dropdown + "manage groups" (GroupManager)
   *  entry point. P4-S3-T1 followup3 (FB-03, feedback `2d1ca7ee9f444564`):
   *  this used to be AnalysisTab's own bar, stacked directly above this
   *  one -- two bars whose only content, with no groups and no selection,
   *  was a "create a group" button apiece ("+ Group" here, "+ Add group"
   *  below). Folded into this single row instead; when no groups exist yet,
   *  this prop is simply omitted (see `groupNames.length > 0` below) and
   *  the "+ Add group" trigger further down is the one remaining way to
   *  create the first group. Omitted entirely by MultiMarkerAnalysisPanel,
   *  which has no group filter of its own -- its layout is unchanged. */
  groupFilter?: {
    groupNames: string[];
    wellGroups: Record<string, string[]>;
    totalWells: number;
    onManageGroups: () => void;
  };
  /** Same reasoning, for the "Show empty wells" checkbox that used to live
   *  at the end of AnalysisTab's group-filter bar. */
  emptyWellsToggle?: {
    hasEmptyWells: boolean;
    showEmptyWells: boolean;
    setShowEmptyWells: (value: boolean) => void;
  };
};

export function WellSelectionToolbar({ groupFilter, emptyWellsToggle }: WellSelectionToolbarProps = {}) {
  const { t } = useI18n();
  const selectedWells = useSelectionStore((s) => s.selectedWells);
  const selectedGroup = useSelectionStore((s) => s.selectedGroup);
  const setGroup = useSelectionStore((s) => s.setGroup);
  const focusSelectedWells = useSelectionStore((s) => s.focusSelectedWells);
  const setFocusSelectedWells = useSelectionStore((s) => s.setFocusSelectedWells);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const sessionId = useSessionStore((s) => s.sessionId);
  const wellGroups = useSessionStore((s) => s.wellGroups);
  const setWellGroups = useSessionStore((s) => s.setWellGroups);
  const [manualNames, setManualNames] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasSelection = selectedWells.length > 0;
  const presetNames = useMemo(
    () => [...DEFAULT_GROUPS, ...manualNames.filter((name) => !DEFAULT_GROUPS.includes(name))],
    [manualNames]
  );
  // P4-S3-T1 (FB-03 §3-2): these 6 slots are "save current selection as group
  // N" presets, not existing groups. With nothing selected and no manual
  // group saved yet, every one of them is a dead button (assignPreset just
  // raises manualGroupSelectFirst) -- render only "+ Add group" instead of
  // 6 meaningless placeholders.
  const showGroupPresets = hasSelection || manualNames.length > 0;

  useEffect(() => {
    if (!sessionId) {
      setManualNames([]);
      return;
    }
    let cancelled = false;
    void getWellGroups(sessionId)
      .then((res) => {
        if (cancelled) return;
        setManualNames(
          Object.entries(res.groups)
            .filter(([, info]) => info.source === "manual")
            .map(([name]) => name)
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const assignPreset = async (name: string) => {
    if (!sessionId || savingName) return false;
    if (!hasSelection) {
      if (manualNames.includes(name) && wellGroups?.[name]) {
        setSaveError(null);
        setGroup(selectedGroup === name ? null : name);
        return true;
      }
      setSaveError(t.manualGroupSelectFirst);
      return false;
    }
    setSavingName(name);
    setSaveError(null);
    try {
      await createWellGroup(sessionId, name, selectedWells);
      setWellGroups({ ...(wellGroups ?? {}), [name]: [...selectedWells] });
      setManualNames((names) => (names.includes(name) ? names : [...names, name]));
      setGroup(name);
      window.dispatchEvent(new CustomEvent("asg-result-dirty"));
      return true;
    } catch (error) {
      console.error("Failed to save manual group preset:", error);
      setSaveError(t.manualGroupSaveFailed);
      return false;
    } finally {
      setSavingName(null);
    }
  };

  const addPreset = async () => {
    const name = newName.trim();
    if (!name) return;
    if (!hasSelection) {
      setSaveError(t.manualGroupSelectFirst);
      return;
    }
    if (await assignPreset(name)) {
      setNewName("");
      setAdding(false);
    }
  };

  return (
    <div
      data-testid="analysis-selection-toolbar"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg px-3 py-2"
    >
      {groupFilter && groupFilter.groupNames.length > 0 && (
        <div className="flex items-center gap-1.5">
          <label htmlFor="well-group-filter" className="text-xs text-text-muted font-medium">
            {t.group}
          </label>
          <select
            id="well-group-filter"
            data-testid="well-group-filter"
            className="px-2 py-1 border border-border rounded text-xs bg-surface text-text"
            value={selectedGroup || ""}
            onChange={(e) => setGroup(e.target.value || null)}
          >
            <option value="">{t.allWells(groupFilter.totalWells)}</option>
            {groupFilter.groupNames.map((name) => (
              <option key={name} value={name}>
                {name} ({groupFilter.wellGroups[name].length})
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="manage-groups-button"
            className="text-xs px-2 py-1 rounded border border-border bg-surface text-text hover:bg-bg cursor-pointer"
            onClick={groupFilter.onManageGroups}
            title={t.manageGroups}
          >
            +
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {showGroupPresets && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="manual-group-presets">
            {presetNames.map((name, index) => {
              const active = selectedGroup === name;
              // Parsed instrument groups are deliberately not presets. A generic
              // imported "Group 1" must not make this manual button look saved or
              // reactivate the unwanted parser grouping the user is replacing.
              const exists = manualNames.includes(name);
              const defaultIndex = DEFAULT_GROUPS.indexOf(name);
              const label = defaultIndex >= 0 ? t.manualGroupLabel(defaultIndex + 1) : name;
              return (
                <button
                  key={name}
                  type="button"
                  data-testid={`manual-group-${index + 1}`}
                  aria-pressed={active}
                  title={!hasSelection && !exists ? t.manualGroupSelectFirst : undefined}
                  onClick={() => void assignPreset(name)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? "border-amber-500 bg-amber-500 text-black shadow-sm"
                      : exists
                      ? "border-amber-500/60 bg-amber-500/10 text-text hover:bg-amber-500/20"
                      : "border-border bg-surface text-text-muted hover:border-amber-500"
                  }`}
                >
                  {active && <Check size={12} aria-hidden="true" />}
                  {label}
                  {savingName === name && <span aria-hidden="true">…</span>}
                </button>
              );
            })}
          </div>
        )}
        {adding ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void addPreset();
            }}
          >
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t.manualGroupNamePlaceholder}
              className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
            />
            <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs text-on-primary">
              {t.add}
            </button>
            <button type="button" onClick={() => setAdding(false)} aria-label={t.cancel}>
              <X size={13} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setAdding(true);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-text-muted hover:border-primary hover:text-primary"
          >
            <Plus size={12} /> {t.manualGroupAdd}
          </button>
        )}
      </div>
      {saveError && <span className="text-xs text-danger" role="alert">{saveError}</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {emptyWellsToggle?.hasEmptyWells && (
          <label
            data-testid="show-empty-wells-toggle"
            className="flex items-center gap-1 text-xs text-text-muted cursor-pointer"
          >
            <input
              type="checkbox"
              checked={emptyWellsToggle.showEmptyWells}
              onChange={(e) => emptyWellsToggle.setShowEmptyWells(e.target.checked)}
            />
            {t.showEmpty}
          </label>
        )}
        <span
          data-testid="analysis-selection-count"
          className="rounded-full bg-surface px-2 py-1 text-xs font-semibold text-text"
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
              ? "border-primary bg-primary text-on-primary"
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
    </div>
  );
}

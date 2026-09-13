import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Focus, Plus, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { createWellGroup, getWellGroups } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import { moveMenuFocus } from "@/lib/menu-focus";

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
  // P15-GROUP-MENU: the 6 preset buttons used to render inline and claimed a
  // full row the moment any well was selected. Collapsed into one trigger +
  // menu; `menuOpen` and the two refs below exist only for that popover.
  const [menuOpen, setMenuOpen] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
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
  // Only surface "active" for a name that is actually one of the rendered
  // presets -- selectedGroup may hold a parser-derived group chosen from the
  // unrelated groupFilter <select> above, which must not light up a preset.
  const activeName = presetNames.find((name) => name === selectedGroup) ?? null;
  const activeDefaultIndex = activeName ? DEFAULT_GROUPS.indexOf(activeName) : -1;
  const activeLabel = activeName
    ? activeDefaultIndex >= 0
      ? t.manualGroupLabel(activeDefaultIndex + 1)
      : activeName
    : null;

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

  const closeGroupMenu = (restoreFocus = true) => {
    setMenuOpen(false);
    setAdding(false);
    if (restoreFocus) groupTriggerRef.current?.focus();
  };

  // Outside click closes the menu, same convention as the shared Menu component.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Menu owns focus while open: land on the first preset row so ArrowDown
  // from the trigger (or a plain click) always starts keyboard navigation
  // somewhere sensible.
  useEffect(() => {
    if (!menuOpen) return;
    groupMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [menuOpen]);

  const onGroupTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMenuOpen(true);
    }
  };

  const onGroupMenuKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === "INPUT") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setAdding(false);
      }
      return;
    }
    if (moveMenuFocus(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeGroupMenu();
    } else if (event.key === "Tab") {
      setMenuOpen(false);
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
        {showGroupPresets ? (
          // P15-GROUP-MENU: the 6 preset buttons + "+ Add group" used to sit
          // side by side and claim a full row the moment any well was
          // selected. Collapsed into one trigger + menu; the "+ New group"
          // row lives inside the menu instead of being its own sibling.
          <div ref={groupMenuRef} className="relative inline-block" data-testid="manual-group-menu">
            <button
              ref={groupTriggerRef}
              type="button"
              data-testid="manual-group-trigger"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t.assignToGroup}
              title={t.assignToGroup}
              onClick={() => setMenuOpen((value) => !value)}
              onKeyDown={onGroupTriggerKeyDown}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-text hover:border-amber-500 cursor-pointer lg:min-h-0"
            >
              {activeLabel && <Check size={12} aria-hidden="true" />}
              <span>{activeLabel ?? t.assignToGroup}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label={t.assignToGroup}
                onKeyDown={onGroupMenuKeyDown}
                className="absolute z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-surface py-1 shadow-lg"
              >
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
                      role="menuitem"
                      data-testid={`manual-group-${index + 1}`}
                      aria-pressed={active}
                      title={!hasSelection && !exists ? t.manualGroupSelectFirst : undefined}
                      onClick={() => {
                        void assignPreset(name);
                        closeGroupMenu();
                      }}
                      className={`flex w-full min-h-11 items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold cursor-pointer lg:min-h-0 ${
                        active
                          ? "bg-amber-500 text-black"
                          : exists
                          ? "text-text hover:bg-amber-500/10"
                          : "text-text-muted hover:bg-bg"
                      }`}
                    >
                      {active && <Check size={12} aria-hidden="true" />}
                      <span className="whitespace-nowrap">{label}</span>
                      {savingName === name && <span aria-hidden="true">…</span>}
                    </button>
                  );
                })}
                <div className="my-1 border-t border-border" role="separator" />
                {adding ? (
                  <form
                    className="flex items-center gap-1 px-2 py-1"
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
                      className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                    />
                    <button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs text-on-primary">
                      {t.add}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      aria-label={t.cancel}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center lg:min-h-0 lg:min-w-0"
                    >
                      <X size={13} />
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSaveError(null);
                      setAdding(true);
                    }}
                    className="flex w-full min-h-11 items-center gap-1.5 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-bg cursor-pointer lg:min-h-0"
                  >
                    <Plus size={12} aria-hidden="true" /> {t.manualGroupAdd}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : adding ? (
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
            <button
              type="button"
              onClick={() => setAdding(false)}
              aria-label={t.cancel}
              className="inline-flex min-h-11 min-w-11 items-center justify-center lg:min-h-0 lg:min-w-0"
            >
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
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-text-muted hover:border-primary hover:text-primary lg:min-h-0"
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

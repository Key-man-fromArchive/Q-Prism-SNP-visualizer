import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { Menu, type MenuItem } from '@/components/shared/ui';
import { navigateTabs } from '@/lib/tab-keyboard';
import type { NavigationTab } from '@/stores/navigation-store';

// Single source of truth for the top-level tab ids lives in navigation-store.ts
// (its `NavigationTab` union) so the two can never drift apart.
export type TabId = NavigationTab;

export type TabNavigationProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  /** When false, session-dependent tabs are disabled */
  hasSession?: boolean;
  /** When true, show admin-only tabs */
  isAdmin?: boolean;
};

type Tab = {
  id: TabId;
  label: string;
  dataTab: string;
  /** Tab works without an active session */
  sessionFree?: boolean;
  /** Tab only visible to admins */
  adminOnly?: boolean;
  /** Low-frequency tab: rendered inside the "More" overflow menu (PRD FR-NAV-1) */
  overflow?: boolean;
};

// Target IA (FB-07 §3-1, feedback 36be23963de2477d): Plate Setup is reached in
// one click (no more nested Plate Setup/Analysis sub-tabs), Raw data comes
// right after it, and the results view is labelled "Results" rather than
// "Analysis". Settings drops into the overflow menu -- P4 moves normalization/
// axis controls onto the plot header, so it no longer needs a primary slot.
const tabs: Tab[] = [
  { id: 'plate', label: 'Plate Setup', dataTab: 'plate' },
  { id: 'rawdata', label: 'Raw data', dataTab: 'rawdata' },
  { id: 'results', label: 'Results', dataTab: 'results' },
  { id: 'quality', label: 'Quality', dataTab: 'quality' },
  { id: 'statistics', label: 'Statistics', dataTab: 'statistics' },
  { id: 'compare', label: 'Compare Runs', dataTab: 'compare' },
  { id: 'library', label: 'Library', dataTab: 'library', sessionFree: true },
  { id: 'project', label: 'Project', dataTab: 'project', sessionFree: true },
  { id: 'settings', label: 'Settings', dataTab: 'settings', overflow: true },
  { id: 'references', label: 'References', dataTab: 'references', sessionFree: true, overflow: true },
  { id: 'users', label: 'Users', dataTab: 'users', sessionFree: true, adminOnly: true, overflow: true },
  { id: 'feedback', label: 'Feedback', dataTab: 'feedback', sessionFree: true, adminOnly: true, overflow: true },
];

export function TabNavigation({ activeTab, onTabChange, hasSession = true, isAdmin = false }: TabNavigationProps) {
  const { t } = useI18n();
  const tabLabels: Record<TabId, string> = {
    plate: t.tabPlate,
    rawdata: t.tabRawdata,
    results: t.tabResults,
    settings: t.tabSettings,
    quality: t.tabQuality,
    statistics: t.tabStatistics,
    compare: t.tabCompare,
    project: t.tabProject,
    users: t.tabUsers,
    references: t.tabReferences,
    library: t.tabLibrary,
    feedback: t.tabFeedback,
  };

  const visible = tabs.filter((tab) => !tab.adminOnly || isAdmin);
  const primary = visible.filter((tab) => !tab.overflow);
  const overflow = visible.filter((tab) => tab.overflow);
  const overflowItems: MenuItem[] = overflow.map((tab) => ({
    key: tab.id,
    label: tabLabels[tab.id],
    onSelect: () => onTabChange(tab.id),
  }));
  const activeInOverflow = overflow.some((tab) => tab.id === activeTab);
  // When the active tab lives in the "More" overflow menu, none of the
  // visible `role="tab"` buttons are selected -- anchor roving tabIndex to
  // the first primary tab instead of hard-coding a removed id.
  const firstPrimaryId = primary[0]?.id;

  return (
    <nav className="app-navigation flex flex-wrap items-center gap-0 border-b border-border bg-surface">
      <div role="tablist" aria-label={t.navigation} onKeyDown={navigateTabs} className="flex flex-wrap min-w-0">
      {primary.map((tab) => {
        const disabled = !hasSession && !tab.sessionFree;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.dataTab}`}
            data-tab={tab.dataTab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`main-panel-${tab.id}`}
            tabIndex={activeTab === tab.id || (activeInOverflow && tab.id === firstPrimaryId) ? 0 : -1}
            onClick={() => { if (!disabled) onTabChange(tab.id); }}
            disabled={disabled}
            className={`
              tab whitespace-nowrap px-3 py-2.5 border-none bg-transparent text-sm transition-colors border-b-2
              ${disabled
                ? 'text-text-muted/40 border-b-transparent cursor-default'
                : activeTab === tab.id
                  ? 'active text-primary border-b-primary font-medium cursor-pointer'
                  : 'text-text-muted border-b-transparent hover:text-text cursor-pointer'
              }
            `}
          >
            {tabLabels[tab.id]}
          </button>
        );
      })}
      </div>
      {overflowItems.length > 0 && (
        <Menu
          label={t.tabMore}
          align="start"
          className="ml-1"
          triggerClassName={`border-none bg-transparent px-3 py-2.5 text-sm ${
            activeInOverflow ? 'text-primary font-medium' : 'text-text-muted'
          }`}
          trigger={<><MoreHorizontal size={16} aria-hidden="true" /> {t.tabMore}</>}
          items={overflowItems}
        />
      )}
    </nav>
  );
}

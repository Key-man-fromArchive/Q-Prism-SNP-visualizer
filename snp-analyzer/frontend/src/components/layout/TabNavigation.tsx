import { MoreHorizontal } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';
import { Menu, type MenuItem } from '@/components/shared/ui';
import { navigateTabs } from '@/lib/tab-keyboard';

export type TabId = 'analysis' | 'protocol' | 'settings' | 'quality' | 'statistics' | 'compare' | 'project' | 'users' | 'references' | 'library' | 'feedback';

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

const tabs: Tab[] = [
  { id: 'analysis', label: 'Analysis', dataTab: 'analysis' },
  { id: 'protocol', label: 'Protocol', dataTab: 'protocol' },
  { id: 'settings', label: 'Settings', dataTab: 'settings' },
  { id: 'quality', label: 'Quality', dataTab: 'quality' },
  { id: 'statistics', label: 'Statistics', dataTab: 'statistics' },
  { id: 'compare', label: 'Compare Runs', dataTab: 'compare' },
  { id: 'library', label: 'Library', dataTab: 'library', sessionFree: true },
  { id: 'project', label: 'Project', dataTab: 'project', sessionFree: true },
  { id: 'references', label: 'References', dataTab: 'references', sessionFree: true, overflow: true },
  { id: 'users', label: 'Users', dataTab: 'users', sessionFree: true, adminOnly: true, overflow: true },
  { id: 'feedback', label: 'Feedback', dataTab: 'feedback', sessionFree: true, adminOnly: true, overflow: true },
];

export function TabNavigation({ activeTab, onTabChange, hasSession = true, isAdmin = false }: TabNavigationProps) {
  const { t } = useI18n();
  const tabLabels: Record<TabId, string> = {
    analysis: t.tabAnalysis,
    protocol: t.tabProtocol,
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
            tabIndex={activeTab === tab.id || (activeInOverflow && tab.id === 'analysis') ? 0 : -1}
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

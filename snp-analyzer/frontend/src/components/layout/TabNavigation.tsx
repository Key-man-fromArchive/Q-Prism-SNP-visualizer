export type TabId = 'analysis' | 'protocol' | 'settings' | 'quality' | 'statistics' | 'compare' | 'project' | 'users';

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
};

const tabs: Tab[] = [
  { id: 'analysis', label: 'Analysis', dataTab: 'analysis' },
  { id: 'protocol', label: 'Protocol', dataTab: 'protocol' },
  { id: 'settings', label: 'Settings', dataTab: 'settings' },
  { id: 'quality', label: 'Quality', dataTab: 'quality' },
  { id: 'statistics', label: 'Statistics', dataTab: 'statistics' },
  { id: 'compare', label: 'Compare Runs', dataTab: 'compare' },
  { id: 'project', label: 'Project', dataTab: 'project', sessionFree: true },
  { id: 'users', label: 'Users', dataTab: 'users', sessionFree: true, adminOnly: true },
];

export function TabNavigation({ activeTab, onTabChange, hasSession = true, isAdmin = false }: TabNavigationProps) {
  return (
    <nav className="flex gap-0 border-b border-border px-6 bg-surface">
      {tabs
        .filter((tab) => !tab.adminOnly || isAdmin)
        .map((tab) => {
          const disabled = !hasSession && !tab.sessionFree;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.dataTab}`}
              data-tab={tab.dataTab}
              onClick={() => { if (!disabled) onTabChange(tab.id); }}
              disabled={disabled}
              className={`
                tab px-5 py-2.5 border-none bg-transparent text-sm transition-colors border-b-2
                ${disabled
                  ? 'text-text-muted/40 border-b-transparent cursor-default'
                  : activeTab === tab.id
                    ? 'active text-primary border-b-primary font-medium cursor-pointer'
                    : 'text-text-muted border-b-transparent hover:text-text cursor-pointer'
                }
              `}
            >
              {tab.label}
            </button>
          );
        })}
    </nav>
  );
}

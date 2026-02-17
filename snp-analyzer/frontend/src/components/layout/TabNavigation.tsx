export type TabId = 'analysis' | 'protocol' | 'settings' | 'quality' | 'statistics' | 'compare' | 'batch';

export type TabNavigationProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
};

type Tab = {
  id: TabId;
  label: string;
  dataTab: string;
};

const tabs: Tab[] = [
  { id: 'analysis', label: 'Analysis', dataTab: 'analysis' },
  { id: 'protocol', label: 'Protocol', dataTab: 'protocol' },
  { id: 'settings', label: 'Settings', dataTab: 'settings' },
  { id: 'quality', label: 'Quality', dataTab: 'quality' },
  { id: 'statistics', label: 'Statistics', dataTab: 'statistics' },
  { id: 'compare', label: 'Compare Runs', dataTab: 'compare' },
  { id: 'batch', label: 'Batch', dataTab: 'batch' },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav className="flex gap-0 border-b border-border px-6 bg-surface">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={`tab-${tab.dataTab}`}
          data-tab={tab.dataTab}
          onClick={() => onTabChange(tab.id)}
          className={`
            tab px-5 py-2.5 border-none bg-transparent cursor-pointer text-sm transition-colors border-b-2
            ${
              activeTab === tab.id
                ? 'active text-primary border-b-primary font-medium'
                : 'text-text-muted border-b-transparent hover:text-text'
            }
          `}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

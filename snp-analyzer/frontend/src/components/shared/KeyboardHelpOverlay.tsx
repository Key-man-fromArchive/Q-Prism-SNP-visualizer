import { X } from 'lucide-react';
import { useI18n } from '@/hooks/use-i18n';

interface Props {
  onClose: () => void;
}

export function KeyboardHelpOverlay({ onClose }: Props) {
  const { t } = useI18n();

  const SECTIONS = [
    {
      title: t.navigation,
      shortcuts: [
        { key: "Space", desc: t.toggleCycleAnimation },
        { key: "\u2190", desc: t.previousCycle },
        { key: "\u2192", desc: t.nextCycle },
      ],
    },
    {
      title: t.keyActions,
      shortcuts: [
        { key: "Ctrl+E", desc: t.exportResultsCSV },
        { key: "D", desc: t.toggleDarkMode },
        { key: "Ctrl+Z", desc: t.undo },
        { key: "Ctrl+Shift+Z", desc: t.redo },
      ],
    },
    {
      title: t.wellTypeAssignment,
      shortcuts: [
        { key: "1", desc: t.wellTypeNTC },
        { key: "2", desc: t.wellTypeUnknown },
        { key: "3", desc: t.wellTypePositiveControl },
        { key: "4", desc: t.wellTypeAllele1Homo },
        { key: "5", desc: t.wellTypeAllele2Homo },
        { key: "6", desc: t.wellTypeHeterozygous },
        { key: "7", desc: t.wellTypeUndetermined },
      ],
    },
    {
      title: t.help,
      shortcuts: [
        { key: "?", desc: t.toggleThisHelp },
        { key: "Esc", desc: t.closeThisHelp },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10000]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-[560px] w-[90%] max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="text-lg font-semibold text-text m-0">
            {t.keyboardShortcuts}
          </h2>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text hover:bg-bg rounded leading-none border-0 bg-transparent cursor-pointer"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.shortcuts.map((s) => (
                  <div
                    key={s.key}
                    className="flex items-center gap-3 py-1"
                  >
                    <kbd className="inline-block px-2 py-1 font-mono text-xs font-semibold text-text bg-bg border border-border rounded shadow-sm min-w-[32px] text-center">
                      {s.key}
                    </kbd>
                    <span className="text-sm text-text">{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-border bg-bg rounded-b-xl">
          <p className="text-xs text-text-muted m-0">
            {t.keyboardTip}
          </p>
        </div>
      </div>
    </div>
  );
}

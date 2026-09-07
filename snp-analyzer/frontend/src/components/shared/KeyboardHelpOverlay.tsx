import { Modal } from './ui/Modal';
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
    <Modal open onClose={onClose} title={t.keyboardShortcuts} widthClassName="max-w-[560px]">
      <div tabIndex={0} role="region" aria-label={t.keyboardShortcuts} className="max-h-[75vh] overflow-y-auto">
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
    </Modal>
  );
}

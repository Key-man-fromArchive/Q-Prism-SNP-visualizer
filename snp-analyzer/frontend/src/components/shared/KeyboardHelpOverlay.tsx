interface Props {
  onClose: () => void;
}

const SECTIONS = [
  {
    title: "Navigation",
    shortcuts: [
      { key: "Space", desc: "Toggle cycle animation" },
      { key: "\u2190", desc: "Previous cycle" },
      { key: "\u2192", desc: "Next cycle" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { key: "Ctrl+E", desc: "Export results to CSV" },
      { key: "D", desc: "Toggle dark mode" },
      { key: "Ctrl+Z", desc: "Undo" },
      { key: "Ctrl+Shift+Z", desc: "Redo" },
    ],
  },
  {
    title: "Well Type Assignment",
    shortcuts: [
      { key: "1", desc: "NTC" },
      { key: "2", desc: "Unknown" },
      { key: "3", desc: "Positive Control" },
      { key: "4", desc: "Allele 1 Homo" },
      { key: "5", desc: "Allele 2 Homo" },
      { key: "6", desc: "Heterozygous" },
      { key: "7", desc: "Undetermined" },
    ],
  },
  {
    title: "Help",
    shortcuts: [
      { key: "?", desc: "Toggle this help" },
      { key: "Esc", desc: "Close this help" },
    ],
  },
];

export function KeyboardHelpOverlay({ onClose }: Props) {
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
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text hover:bg-bg rounded text-2xl leading-none border-0 bg-transparent cursor-pointer"
          >
            &times;
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
            Tip: Select wells in the scatter plot or plate view before using well type shortcuts
          </p>
        </div>
      </div>
    </div>
  );
}

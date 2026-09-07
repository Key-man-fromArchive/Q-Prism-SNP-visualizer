import type { KeyboardEvent } from 'react';
export function navigateTabs(event: KeyboardEvent) {
  if (event.defaultPrevented || event.nativeEvent.keyCode === 229) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const index = tabs.findIndex(tab => tab === document.activeElement);
  const moves: Record<string, number> = { ArrowRight: (index + 1) % tabs.length,
    ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
  const next = tabs[moves[event.key]];
  if (!next) return;
  event.preventDefault(); event.stopPropagation(); next.focus(); next.click();
}

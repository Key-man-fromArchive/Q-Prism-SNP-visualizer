import type { KeyboardEvent } from 'react';
/** DOM order is authoritative and disabled options never receive focus. */
export function moveMenuFocus(event: KeyboardEvent): boolean {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const index = items.findIndex(item => item === document.activeElement);
  const targets: Record<string, number> = {
    ArrowDown: (index + 1) % items.length,
    ArrowUp: (index - 1 + items.length) % items.length,
    Home: 0, End: items.length - 1,
  };
  const target = targets[event.key];
  if (target === undefined) return false;
  event.preventDefault(); event.stopPropagation(); items[target]?.focus(); return true;
}

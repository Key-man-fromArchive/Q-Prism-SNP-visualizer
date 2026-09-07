/** Native widgets own their navigation keys; grids explicitly allow application commands. */
function unsafeEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return true;
  return event.altKey || event.getModifierState('AltGraph') || event.repeat;
}
export function ownsKeyboardEvent(event: KeyboardEvent): boolean {
  if (unsafeEvent(event)) return true;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]')) return true;
  if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return true;
  const navigation = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'];
  if (target?.closest('[role="grid"]')) return navigation.includes(event.key);
  const widget = target?.closest('button,a[href],summary,[role="tab"],[role="slider"],[role="spinbutton"],[role="checkbox"],[role="radio"],[role="switch"],[role="listbox"],audio,video');
  return Boolean(widget) && !['d', 'D', '?'].includes(event.key);
}

export function adjacentCycle(cycles: readonly number[], current: number, direction: -1 | 1): number | null {
  const index = cycles.indexOf(current);
  if (index < 0) return null;
  return cycles[index + direction] ?? null;
}

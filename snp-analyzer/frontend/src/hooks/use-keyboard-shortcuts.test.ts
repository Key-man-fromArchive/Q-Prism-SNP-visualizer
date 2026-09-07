import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from './use-keyboard-shortcuts';
import { adjacentCycle } from '@/lib/keyboard-routing';

afterEach(() => { cleanup(); document.body.replaceChildren(); });

it.each(['MacIntel', 'Win32'])('routes available shared undo/redo on %s without consuming unavailable/native input', platform => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const undo = vi.fn(), redo = vi.fn();
  let available = true;
  renderHook(() => useKeyboardShortcuts({ undo, redo, canExecute: () => available }));
  const modifiers = { metaKey: platform === 'MacIntel', ctrlKey: platform !== 'MacIntel' };
  function press(key: string, shiftKey = false, target: EventTarget = window) {
    const event = new KeyboardEvent('keydown', { key, shiftKey, ...modifiers, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  }
  expect(press('z')).toBe(true);
  expect(press('Z', true)).toBe(true);
  expect(undo).toHaveBeenCalledTimes(1);
  expect(redo).toHaveBeenCalledTimes(1);
  expect(press('y')).toBe(platform === 'Win32');
  available = false;
  expect(press('z')).toBe(false);
  available = true;
  const input = document.createElement('input'); document.body.append(input);
  expect(press('z', false, input)).toBe(false);
  expect(undo).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it.each(['MacIntel', 'Win32'])('keeps undo native and accepts only the primary export modifier on %s', platform => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  const exportCSV = vi.fn();
  const undo = vi.fn();
  renderHook(() => useKeyboardShortcuts({ exportCSV, undo, redo: undo }));
  for (const key of ['z', 'Z', 'y']) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, metaKey: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  const wrong = new KeyboardEvent('keydown', { key: 'e', ctrlKey: platform === 'MacIntel', metaKey: platform !== 'MacIntel', cancelable: true });
  act(() => { window.dispatchEvent(wrong); });
  expect(exportCSV).not.toHaveBeenCalled();
  expect(wrong.defaultPrevented).toBe(false);
  const right = new KeyboardEvent('keydown', { key: 'e', metaKey: platform === 'MacIntel', ctrlKey: platform !== 'MacIntel', cancelable: true });
  act(() => { window.dispatchEvent(right); });
  expect(exportCSV).toHaveBeenCalledTimes(1);
  expect(undo).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it.each([
  ['button', ' ', {}],
  ['[role="tab"]', 'ArrowRight', {}],
  ['[role="slider"]', 'ArrowLeft', {}],
  ['[contenteditable="true"]', '1', {}],
  ['[role="textbox"]', 'd', {}],
  ['div', ' ', { isComposing: true }],
  ['div', '1', { keyCode: 229 }],
  ['div', '1', { altKey: true }],
  ['div', ' ', { repeat: true }],
] as const)('preserves owned or unsafe key %s %s', (selector, key, options) => {
  const callback = vi.fn();
  renderHook(() => useKeyboardShortcuts({ togglePlay: callback, nextCycle: callback,
    prevCycle: callback, assignWellType: callback, toggleDarkMode: callback }));
  const target = document.createElement(selector === 'button' ? 'button' : 'div');
  const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
  if (attribute) target.setAttribute(attribute[1], attribute[2]);
  document.body.append(target);
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  act(() => { target.dispatchEvent(event); });
  expect(callback).not.toHaveBeenCalled();
  expect(event.defaultPrevented).toBe(false);
});

it('respects a child handler that already prevented the event', () => {
  const togglePlay = vi.fn();
  renderHook(() => useKeyboardShortcuts({ togglePlay }));
  const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
  event.preventDefault();
  act(() => { window.dispatchEvent(event); });
  expect(togglePlay).not.toHaveBeenCalled();
});

it('uses actual sparse cycles including zero and stops at both ends', () => {
  expect(adjacentCycle([0, 10, 40], 10, -1)).toBe(0);
  expect(adjacentCycle([0, 10, 40], 10, 1)).toBe(40);
  expect(adjacentCycle([0, 10, 40], 0, -1)).toBeNull();
  expect(adjacentCycle([0, 10, 40], 40, 1)).toBeNull();
  expect(adjacentCycle([0, 10, 40], 9, 1)).toBeNull();
});
it('does not consume unavailable actions or modified browser navigation', () => {
  const togglePlay = vi.fn();
  renderHook(() => useKeyboardShortcuts({ togglePlay, canExecute: () => false }));
  for (const options of [{ key: ' ' }, { key: 'ArrowRight', ctrlKey: true }, { key: '1', shiftKey: true }]) {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...options });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  }
  expect(togglePlay).not.toHaveBeenCalled();
});

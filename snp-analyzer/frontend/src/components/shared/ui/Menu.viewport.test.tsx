import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';

const items = [{ key: 'a', label: 'A very long export menu entry', onSelect: vi.fn() }];

function openWithMenuRect(left: number, right: number, viewport = 390) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: viewport });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const inMenu = this.getAttribute('role') === 'menu';
    return { left: inMenu ? left : 0, right: inMenu ? right : 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
  render(<Menu label="Export" trigger="Export" items={items} />);
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  return screen.getByRole('menu');
}

describe('Menu viewport clamp', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shifts a menu that overflows the left edge back inside', () => {
    expect(openWithMenuRect(-16, 200).style.transform).toBe('translateX(24px)');
  });

  it('shifts a menu that overflows the right edge back inside', () => {
    expect(openWithMenuRect(200, 410).style.transform).toBe('translateX(-28px)');
  });

  it('leaves an in-bounds menu untouched and caps its width', () => {
    const menu = openWithMenuRect(20, 200);
    expect(menu.style.transform).toBe('');
    expect(menu.className).toContain('max-w-[calc(100vw-16px)]');
  });
});

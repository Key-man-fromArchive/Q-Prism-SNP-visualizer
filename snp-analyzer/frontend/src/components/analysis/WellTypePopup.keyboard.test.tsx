import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WellTypePopup } from './WellTypePopup';
it('focuses its first option, navigates and returns focus on close', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const close = vi.fn();
  const assign = vi.fn();
  const view = render(<WellTypePopup wells={['A1']} position={{ x: 0, y: 0 }} onAssign={assign} onClose={close} />);
  const menu = screen.getByRole('menu');
  const items = screen.getAllByRole('menuitem');
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(menu, { key: 'End' });
  expect(document.activeElement).toBe(items.at(-1));
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});

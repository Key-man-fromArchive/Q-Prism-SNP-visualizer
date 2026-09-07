import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Menu } from './Menu';
it('skips disabled items on entry/navigation and returns to its trigger', () => {
  render(<Menu label="Exports" trigger="Exports" items={[
    { key: 'off', label: 'Unavailable', disabled: true, onSelect: vi.fn() },
    { key: 'a', label: 'CSV', onSelect: vi.fn() },
    { key: 'b', label: 'PNG', onSelect: vi.fn() },
  ]} />);
  const trigger = screen.getByRole('button', { name: 'Exports' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'CSV' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'PNG' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
});

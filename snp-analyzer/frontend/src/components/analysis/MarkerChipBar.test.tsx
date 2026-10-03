import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkerChipBar } from './MarkerChipBar';
import { fitChipCount, type MarkerChipState } from '@/lib/marker-chip';
import { useLanguageStore } from '@/stores/language-store';
import type { MarkerRegion } from '@/types/api';

const make = (n: number): MarkerRegion[] => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`, name: `Marker ${i + 1}`, wells: [`A${i + 1}`], ploidy: 2, color: '#112233',
}));
const status = (m: MarkerRegion): MarkerChipState => (m.id === 'm1' ? 'none' : m.id === 'm2' ? 'pending' : 'called');

beforeEach(() => useLanguageStore.getState().setLanguage('en'));
afterEach(() => vi.restoreAllMocks());

it('keeps as many chips as fit and reserves room for the more button', () => {
  expect(fitChipCount([100, 100, 100], 400, 80, 8)).toBe(3);
  expect(fitChipCount([100, 100, 100], 250, 80, 8)).toBe(1);
  expect(fitChipCount([100, 100, 100], 50, 80, 8)).toBe(1);
  expect(fitChipCount([], 100, 80, 8)).toBe(0);
});

it('renders one tab per marker with colour, name and a state mark', () => {
  render(<MarkerChipBar markers={make(3)} selectedId="m0" onSelect={() => {}} statusOf={status} warningsOf={() => []} />);
  const bar = screen.getByTestId('marker-chip-bar');
  expect(bar).toHaveAttribute('role', 'tablist');
  const chips = within(bar).getAllByTestId('marker-chip');
  expect(chips).toHaveLength(3);
  expect(chips[0]).toHaveAttribute('role', 'tab');
  expect(chips[0]).toHaveAttribute('aria-selected', 'true');
  expect(chips[1]).toHaveAttribute('aria-selected', 'false');
  expect(chips[0]).toHaveTextContent('Marker 1');
  expect(chips.map((c) => c.querySelector('[data-testid="marker-chip-state"]')!.getAttribute('data-state')))
    .toEqual(['called', 'none', 'pending']);
  expect(screen.queryByTestId('marker-chip-more')).toBeNull();
});

it('moves with the arrow keys, wrapping at both ends', () => {
  const onSelect = vi.fn();
  render(<MarkerChipBar markers={make(3)} selectedId="m0" onSelect={onSelect} statusOf={status} warningsOf={() => []} />);
  const chips = screen.getAllByTestId('marker-chip');
  expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1]);
  fireEvent.keyDown(chips[0], { key: 'ArrowRight' });
  expect(onSelect).toHaveBeenLastCalledWith('m1');
  fireEvent.keyDown(chips[0], { key: 'ArrowLeft' });
  expect(onSelect).toHaveBeenLastCalledWith('m2');
  fireEvent.keyDown(chips[0], { key: 'End' });
  expect(onSelect).toHaveBeenLastCalledWith('m2');
  fireEvent.click(chips[1]);
  expect(onSelect).toHaveBeenLastCalledWith('m1');
});

it('moves the overflow into a more dropdown and keeps the selection visible', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(250);
  const onSelect = vi.fn();
  const { rerender } = render(<MarkerChipBar markers={make(4)} selectedId="m0" onSelect={onSelect}
    statusOf={status} warningsOf={() => []} />);
  expect(screen.getAllByTestId('marker-chip')).toHaveLength(1);
  const more = screen.getByTestId('marker-chip-more') as HTMLSelectElement;
  expect(more.options).toHaveLength(4); // placeholder + 3 hidden markers
  fireEvent.change(more, { target: { value: 'm3' } });
  expect(onSelect).toHaveBeenCalledWith('m3');
  rerender(<MarkerChipBar markers={make(4)} selectedId="m3" onSelect={onSelect} statusOf={status} warningsOf={() => []} />);
  const chips = screen.getAllByTestId('marker-chip');
  expect(chips).toHaveLength(1);
  expect(chips[0]).toHaveTextContent('Marker 4');
  expect(chips[0]).toHaveAttribute('aria-selected', 'true');
});

it('shows a warning mark with its text', () => {
  render(<MarkerChipBar markers={make(1)} selectedId="m0" onSelect={() => {}} statusOf={status}
    warningsOf={() => ['low separation']} />);
  expect(screen.getByTestId('marker-chip-warning')).toHaveAttribute('title', 'low separation');
});

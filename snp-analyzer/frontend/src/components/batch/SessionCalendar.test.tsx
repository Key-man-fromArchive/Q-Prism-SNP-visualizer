import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SessionCalendar } from './SessionCalendar';
import { useLanguageStore } from '@/stores/language-store';
import type { SessionListItem } from '@/types/api';

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return { session_id: 's', instrument: 'CFX Opus', num_wells: 96, num_cycles: 40, uploaded_at: '2026-09-14 04:55:29', ...overrides };
}

beforeEach(() => { useLanguageStore.setState({ language: 'en' }); });

it('opens on the month of the most recent session and hints to pick a date before any is selected', () => {
  render(<SessionCalendar sessions={[session({ uploaded_at: '2026-09-14 04:55:29' })]} onOpen={vi.fn()} />);
  expect(screen.getByText('September 2026')).toBeVisible();
  expect(screen.getByText('Select a date to see its sessions.')).toBeVisible();
});

it('marks the day that has sessions and lets a click reveal them', () => {
  const a = session({ session_id: 'a', raw_filename: 'run-a.eds', uploaded_at: '2026-09-14 04:55:29' });
  const b = session({ session_id: 'b', raw_filename: 'run-b.eds', uploaded_at: '2026-09-14 09:00:00' });
  render(<SessionCalendar sessions={[a, b]} onOpen={vi.fn()} />);
  const day14 = screen.getByRole('gridcell', { name: /September 14, 2026/ });
  expect(day14).toHaveAccessibleName(/2 sessions/);
  fireEvent.click(day14);
  expect(screen.getByText('run-a.eds')).toBeVisible();
  expect(screen.getByText('run-b.eds')).toBeVisible();
});

it('shows a distinct empty message for an in-month day with no sessions, not the list', () => {
  render(<SessionCalendar sessions={[session({ uploaded_at: '2026-09-14 04:55:29' })]} onOpen={vi.fn()} />);
  const day2 = screen.getByRole('gridcell', { name: /September 2, 2026/ });
  expect(day2).not.toHaveAccessibleName(/session/);
  fireEvent.click(day2);
  expect(screen.getByText('No sessions on this date.')).toBeVisible();
});

it('calls onOpen with the clicked session id, not just the day', () => {
  const onOpen = vi.fn();
  const a = session({ session_id: 'session-a', raw_filename: 'run-a.eds', uploaded_at: '2026-09-14 04:55:29' });
  render(<SessionCalendar sessions={[a]} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('gridcell', { name: /September 14, 2026/ }));
  fireEvent.click(screen.getByRole('button', { name: /run-a\.eds/ }));
  expect(onOpen).toHaveBeenCalledWith('session-a');
});

it('does not break when a day has 9 sessions -- all remain reachable in a bounded, scrollable list', () => {
  const nine = Array.from({ length: 9 }, (_, i) =>
    session({ session_id: `s${i}`, raw_filename: `run-${i}.eds`, uploaded_at: `2026-08-31 0${i}:00:00` }));
  render(<SessionCalendar sessions={nine} onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('gridcell', { name: /August 31, 2026/ }));
  const list = screen.getByTestId('calendar-day-sessions');
  expect(within(list).getAllByRole('button')).toHaveLength(9);
});

it('renders an unremarkable empty grid instead of crashing when there are no sessions at all', () => {
  render(<SessionCalendar sessions={[]} onOpen={vi.fn()} />);
  expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(27);
  expect(screen.queryByText(/\d+ sessions?/)).not.toBeInTheDocument();
});

it('moves focus between days with the arrow keys without activating them', () => {
  const onOpen = vi.fn();
  render(<SessionCalendar sessions={[session({ uploaded_at: '2026-09-14 04:55:29' })]} onOpen={onOpen} />);
  const day14 = screen.getByRole('gridcell', { name: /September 14, 2026/ });
  day14.focus();
  fireEvent.keyDown(day14, { key: 'ArrowRight' });
  const day15 = screen.getByRole('gridcell', { name: /September 15, 2026/ });
  expect(document.activeElement).toBe(day15);
  expect(onOpen).not.toHaveBeenCalled();
});

it('navigates to the next and previous month and disables cross-month days', () => {
  render(<SessionCalendar sessions={[session({ uploaded_at: '2026-09-14 04:55:29' })]} onOpen={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('October 2026')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(screen.getByText('August 2026')).toBeVisible();
  expect(screen.getByText('No sessions this month.')).toBeVisible();
});

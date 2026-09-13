// @TASK P4-S3-T1 - Conditional group-preset rendering (FB-03 §3-2)
// @SPEC docs/planning/feedback-2026-09-11/FB-03-analysis-density.md §3-2
// @TASK P15-GROUP-MENU - Collapse the 6 group-preset buttons into a menu
// @SPEC docs/planning/feedback-2026-09-11/evidence/P15-GROUP-MENU.md
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { WellSelectionToolbar } from './WellSelectionToolbar';
import { createWellGroup, getWellGroups } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/api', () => ({
  getWellGroups: vi.fn().mockResolvedValue({ groups: {} }),
  createWellGroup: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWellGroups).mockResolvedValue({ groups: {} });
  vi.mocked(createWellGroup).mockResolvedValue({ status: 'ok', name: '', wells: [] });
  useLanguageStore.getState().setLanguage('en');
  useSessionStore.setState({ sessionId: 's', wellGroups: null });
  useSelectionStore.setState({ selectedWells: [], selectedGroup: null, focusSelectedWells: false });
});

it('hides the group-assign control on a plate with no manual groups and no selection', async () => {
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  expect(screen.queryByTestId('manual-group-menu')).not.toBeInTheDocument();
  expect(screen.queryByTestId('manual-group-trigger')).not.toBeInTheDocument();
  expect(screen.queryByTestId('manual-group-1')).not.toBeInTheDocument();
  // "+ Add group" always remains -- it is the only way to create the first one.
  expect(screen.getByRole('button', { name: /Add group/i })).toBeInTheDocument();
});

it('reveals a single "assign to group" trigger once wells are selected, not 6 buttons', async () => {
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  expect(screen.getByTestId('manual-group-menu')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-trigger')).toBeInTheDocument();
  // Collapsed: none of the 6 preset rows exist until the menu is opened.
  expect(screen.queryByTestId('manual-group-1')).not.toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('reveals a previously-saved manual group as a trigger even with nothing selected', async () => {
  vi.mocked(getWellGroups).mockResolvedValue({ groups: { 'Group 1': { wells: ['A1'], source: 'manual' } } });
  render(<WellSelectionToolbar />);
  await screen.findByTestId('manual-group-trigger');
});

it('opens the menu on trigger click and lists every preset as a menuitem', async () => {
  const user = userEvent.setup();
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  await user.click(screen.getByTestId('manual-group-trigger'));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-1')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-6')).toBeInTheDocument();
});

it('assigns the current selection to a group chosen from the menu', async () => {
  const user = userEvent.setup();
  useSelectionStore.setState({ selectedWells: ['A1', 'A2'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  await user.click(screen.getByTestId('manual-group-trigger'));
  await user.click(screen.getByTestId('manual-group-1'));
  await waitFor(() => expect(createWellGroup).toHaveBeenCalledWith('s', 'Group 1', ['A1', 'A2']));
  // The collapsed trigger now shows which group is active.
  expect(screen.getByTestId('manual-group-trigger')).toHaveTextContent('Group 1');
});

it('distinguishes an existing manual group from an unused default preset inside the menu', async () => {
  const user = userEvent.setup();
  vi.mocked(getWellGroups).mockResolvedValue({ groups: { 'Group 2': { wells: ['A1'], source: 'manual' } } });
  useSelectionStore.setState({ selectedWells: ['A1'] });
  render(<WellSelectionToolbar />);
  await screen.findByTestId('manual-group-trigger');
  await user.click(screen.getByTestId('manual-group-trigger'));
  const existing = screen.getByTestId('manual-group-2');
  const unused = screen.getByTestId('manual-group-1');
  expect(existing.className).not.toBe(unused.className);
});

it('marks the currently selected group active with aria-pressed and a check mark', async () => {
  const user = userEvent.setup();
  vi.mocked(getWellGroups).mockResolvedValue({ groups: { 'Group 1': { wells: ['A1'], source: 'manual' } } });
  useSelectionStore.setState({ selectedGroup: 'Group 1' });
  render(<WellSelectionToolbar />);
  await screen.findByTestId('manual-group-trigger');
  await user.click(screen.getByTestId('manual-group-trigger'));
  const active = screen.getByTestId('manual-group-1');
  expect(active).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('manual-group-6')).toHaveAttribute('aria-pressed', 'false');
});

it('creates a manual group with a new name from inside the menu', async () => {
  const user = userEvent.setup();
  useSelectionStore.setState({ selectedWells: ['A1'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  await user.click(screen.getByTestId('manual-group-trigger'));
  await user.click(screen.getByRole('menuitem', { name: /Add group/i }));
  await user.type(screen.getByPlaceholderText('Group name'), 'Repeats');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(createWellGroup).toHaveBeenCalledWith('s', 'Repeats', ['A1']));
});

it('never shows a parser-derived "Group 1" as an already-saved manual group', async () => {
  const user = userEvent.setup();
  // source: "parsed", not "manual" -- must not be treated as a saved preset.
  vi.mocked(getWellGroups).mockResolvedValue({ groups: { 'Group 1': { wells: ['A1'], source: 'parsed' } } });
  useSelectionStore.setState({ selectedWells: ['A1'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  await user.click(screen.getByTestId('manual-group-trigger'));
  const groupOne = screen.getByTestId('manual-group-1');
  expect(groupOne.className).not.toContain('amber-500/10');
  expect(groupOne.className).not.toContain('bg-amber-500');
});

it('opens and closes the menu with the keyboard, selecting a group without a mouse', async () => {
  const user = userEvent.setup();
  useSelectionStore.setState({ selectedWells: ['A1'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  const trigger = screen.getByTestId('manual-group-trigger');
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByTestId('manual-group-1')).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(createWellGroup).toHaveBeenCalledWith('s', 'Group 1', ['A1']));
  // Selecting an item closes the menu and returns focus to the trigger.
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('closes the menu on Escape and returns focus to the trigger', async () => {
  const user = userEvent.setup();
  useSelectionStore.setState({ selectedWells: ['A1'] });
  render(<WellSelectionToolbar />);
  await waitFor(() => expect(getWellGroups).toHaveBeenCalled());
  const trigger = screen.getByTestId('manual-group-trigger');
  await user.click(trigger);
  expect(screen.getByRole('menu')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

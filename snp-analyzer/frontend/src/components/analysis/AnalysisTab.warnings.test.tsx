// @TASK P4-S3-T1 - Warning demotion respects severity grading (FB-03 §3-1, §8)
// @SPEC docs/planning/feedback-2026-09-11/FB-03-analysis-density.md §3-1
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AnalysisTab } from './AnalysisTab';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useNavigationStore } from '@/stores/navigation-store';

// A synthetic mix of severities: today's real codes (lib/analysis-warnings.ts)
// are all "blocking" by QC policy -- this mock is the only way to exercise
// the "advisory" demotion path the mechanism must still support.
vi.mock('@/lib/analysis-warnings', () => ({
  gradedAnalysisWarnings: (codes: string[] | null | undefined) =>
    (codes ?? []).map((code) => ({
      code,
      text: `warning text: ${code}`,
      severity: code === 'advisory_code' ? 'advisory' as const : 'blocking' as const,
    })),
}));

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getWellGroups: vi.fn().mockResolvedValue({ groups: {} }),
}));
vi.mock('./CycleControl', () => ({ CycleControl: () => null }));
vi.mock('./ScatterPlot', () => ({ ScatterPlot: () => null }));
vi.mock('./PlateView', () => ({ PlateView: () => null }));
vi.mock('./WellDetailPanel', () => ({ WellDetailPanel: () => null }));
vi.mock('./ResultsTable', () => ({ ResultsTable: () => null }));
vi.mock('./AmplificationOverlay', () => ({ AmplificationOverlay: () => null }));
vi.mock('./GroupManager', () => ({ GroupManager: () => null }));
vi.mock('./WellSelectionToolbar', () => ({ WellSelectionToolbar: () => null }));
vi.mock('./WellTypePopup', () => ({ WellTypePopup: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.getState().reset();
  useLanguageStore.getState().setLanguage('en');
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 'warnings-fixture', wellGroups: null });
  useSelectionStore.setState({ currentCycle: 0, selectedWells: [], selectedGroup: null });
  useAnalysisStore.getState().setSession('warnings-fixture', 'u');
  useAnalysisStore.getState().updateInputRevision('warnings-fixture', 'u', 0);
  useNavigationStore.setState({ session: 'warnings-fixture', tab: 'analysis', status: 'ready', exportRestoring: false });
});

it('keeps blocking warnings above the fold and counts them in the toolbar badge', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, warnings: ['blocking_code'] } as never });
  render(<AnalysisTab />);
  const blocking = screen.getByTestId('analysis-warnings');
  expect(blocking).toHaveTextContent('warning text: blocking_code');
  expect(screen.queryByTestId('analysis-warnings-advisory')).not.toBeInTheDocument();
  expect(screen.getByTestId('analysis-warnings-badge')).toHaveTextContent('1');
});

it('demotes advisory warnings below the results while blocking ones stay on top', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, warnings: ['blocking_code', 'advisory_code'] } as never });
  render(<AnalysisTab />);
  expect(screen.getByTestId('analysis-warnings')).toHaveTextContent('warning text: blocking_code');
  expect(screen.getByTestId('analysis-warnings')).not.toHaveTextContent('advisory_code');
  const advisory = screen.getByTestId('analysis-warnings-advisory');
  expect(advisory).toHaveTextContent('warning text: advisory_code');
  expect(screen.getByTestId('analysis-warnings-badge')).toHaveTextContent('2');
});

it('keeps warning regions live and focusable, and jumps to them from the badge', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, warnings: ['blocking_code', 'advisory_code'] } as never });
  render(<AnalysisTab />);
  const blockingRegion = screen.getByTestId('analysis-warnings').parentElement!;
  const advisoryRegion = screen.getByTestId('analysis-warnings-advisory').parentElement!;
  expect(blockingRegion).toHaveAttribute('aria-live', 'assertive');
  expect(advisoryRegion).toHaveAttribute('aria-live', 'polite');
  fireEvent.click(screen.getByTestId('analysis-warnings-badge'));
  // Advisory warnings exist here, so the badge jumps to the demoted region.
  expect(document.activeElement).toBe(advisoryRegion);
});

it('renders no warning badge or blocks when the result has no warnings', () => {
  useAnalysisStore.setState({ result: { algorithm: 'auto', cycle: 20, assignments: {}, warnings: [] } as never });
  render(<AnalysisTab />);
  expect(screen.queryByTestId('analysis-warnings-badge')).not.toBeInTheDocument();
  expect(screen.queryByTestId('analysis-warnings')).not.toBeInTheDocument();
  expect(screen.queryByTestId('analysis-warnings-advisory')).not.toBeInTheDocument();
});

it('shows the plate-view selection hint only until wells are selected', () => {
  useAnalysisStore.setState({ result: null });
  const view = render(<AnalysisTab />);
  expect(screen.getByTestId('plate-view-hint')).toBeInTheDocument();
  useSelectionStore.setState({ selectedWells: ['A1'] });
  view.rerender(<AnalysisTab />);
  expect(screen.queryByTestId('plate-view-hint')).not.toBeInTheDocument();
});

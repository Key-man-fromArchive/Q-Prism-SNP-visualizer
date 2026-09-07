import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { PlateScopeSummary } from './PlateScopeSummary';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { UploadResponse } from '@/types/api';

const info: UploadResponse = { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 3, num_cycles: 2,
  has_rox: false, data_windows: null, suggested_cycle: 40, well_groups: null, well_ids: ['A1', 'A2', 'P24'] };
beforeEach(() => {
  useSessionStore.setState({ sessionId: 's', sessionInfo: info });
  useDataStore.setState({ wellTypeAssignments: { A2: 'Empty', P24: 'Omit' }, plateWells: [] });
  useLanguageStore.getState().setLanguage('en');
});
it('updates 0→1→multiple→0 marker membership without double-counting role exclusions', () => {
  const view = render(<PlateScopeSummary markers={[]} />);
  expect(screen.getByTestId('whole-plate-banner')).toBeVisible();
  expect(screen.queryByTestId('unassigned-banner')).not.toBeInTheDocument();
  view.rerender(<PlateScopeSummary markers={[{ wells: ['A1'] }]} />);
  expect(screen.getByTestId('unassigned-count')).toHaveTextContent('2 input well(s)');
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('Input wells: 3 · Eligible by marker/type: 1 · Empty: 1 · Omit: 1');
  view.rerender(<PlateScopeSummary markers={[{ wells: ['A1', 'A2'] }, { wells: ['A1', 'P24'] }]} />);
  expect(screen.queryByTestId('unassigned-banner')).not.toBeInTheDocument();
  view.rerender(<PlateScopeSummary markers={[{ wells: [] }]} />);
  expect(screen.getByTestId('whole-plate-banner')).toBeVisible();
});
it('ignores cycle missing readings and all view filters; type recovery changes eligibility', () => {
  render(<PlateScopeSummary markers={[{ wells: ['A1', 'P24'] }]} />);
  const before = screen.getByTestId('analysis-scope-counts').textContent;
  act(() => {
    useSelectionStore.setState({ selectedWells: ['A1'], selectedGroup: 'Group1', currentCycle: 0 });
    useSettingsStore.setState({ showEmptyWells: true });
    useDataStore.setState({ plateWells: [] });
  });
  expect(screen.getByTestId('analysis-scope-counts').textContent).toBe(before);
  act(() => useDataStore.setState({ wellTypeAssignments: { A2: 'Empty', P24: 'Unknown' } }));
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('Eligible by marker/type: 2 · Empty: 1 · Omit: 0');
});
it('does not guess counts for legacy inventory and localizes whole-plate guidance', () => {
  useSessionStore.setState({ sessionInfo: { ...info, well_ids: undefined } });
  render(<PlateScopeSummary markers={[]} />);
  expect(screen.queryByTestId('analysis-scope-counts')).not.toBeInTheDocument();
  expect(screen.getByText(/inventory unavailable/)).toBeVisible();
  act(() => useLanguageStore.getState().setLanguage('ko'));
  expect(screen.getByTestId('whole-plate-banner')).toHaveTextContent('전체 플레이트를 하나의 마커');
});

it('localizes precise marker and role counts in Korean', () => {
  useLanguageStore.getState().setLanguage('ko');
  render(<PlateScopeSummary markers={[{ wells: ['A1'] }]} />);
  expect(screen.getByTestId('unassigned-count')).toHaveTextContent('입력 웰 2개');
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent('입력 웰: 3 · 마커/유형 기준 대상: 1 · Empty: 1 · Omit: 1');
});

it('renders exact full 384 counts independent of display filters', () => {
  const well_ids = Array.from({ length: 16 }, (_, row) => Array.from({ length: 24 }, (_, col) => `${String.fromCharCode(65 + row)}${col + 1}`)).flat();
  useSessionStore.setState({ sessionInfo: { ...info, well_ids, num_wells: 384 } });
  useDataStore.setState({ wellTypeAssignments: { A1: 'Empty', A2: 'Omit', B1: 'Omit' } });
  render(<PlateScopeSummary markers={[{ wells: well_ids.slice(0, 24) }, { wells: well_ids.slice(24, 48) }]} />);
  const expected = 'Input wells: 384 · Eligible by marker/type: 45 · Empty: 1 · Omit: 2';
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent(expected);
  expect(screen.getByTestId('unassigned-count')).toHaveTextContent('336 input well(s)');
  act(() => {
    useSettingsStore.setState({ showEmptyWells: false });
    useSelectionStore.setState({ selectedGroup: 'Group1', selectedWells: ['P24'] });
  });
  expect(screen.getByTestId('analysis-scope-counts')).toHaveTextContent(expected);
});

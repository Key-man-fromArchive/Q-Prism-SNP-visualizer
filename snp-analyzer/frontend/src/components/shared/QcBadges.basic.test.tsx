import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QcBadges } from './QcBadges';
import { getQc } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { QcResponse } from '@/types/api';

vi.mock('@/lib/api', () => ({ getQc: vi.fn(), suggestCycle: vi.fn(), runClustering: vi.fn() }));
const qc = (): QcResponse => ({ call_rate: 1, n_called: 4, n_total: 4, cluster_separation: null,
  ntc_check: { ok: false, status: 'no_ntc', scope: 'plate', cycle: 0, use_rox: false, normalization_applied: false,
    background: 'none', wells: [] },
  input_revision: null, current_input_revision: 0, result_revision: null, analysis_context: null,
  context_status: 'verified', judgment_status: 'verified', judgment_reason: 'ok',
  analysis_status: 'completed', analysis_pending: false,
  authoritative: 'markers', markers: [{ id: 'm1', name: 'QPrism1', call_rate: 1, n_called: 4, n_total: 4, cluster_separation: null }],
} as unknown as QcResponse);

beforeEach(() => {
  vi.resetAllMocks();
  useLanguageStore.setState({ language: 'ko' });
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
  useAuthStore.getState().setUser({ id: 'u', username: 'u', display_name: null, role: 'user' });
  useSessionStore.getState().setSession('s', { session_id: 's', instrument: 'synthetic', allele2_dye: 'VIC', num_wells: 4,
    num_cycles: 3, has_rox: false, data_windows: null, suggested_cycle: 0, well_groups: null });
  useAnalysisStore.getState().setSession('s', 'u');
  useNavigationStore.setState({ status: 'ready', session: 's', cycle: 0, availableCycles: [0, 10, 40], marker: 'm1' });
  vi.mocked(getQc).mockResolvedValue(qc());
});

it('summarises one status word with its single cause, without the QC refresh button', async () => {
  render(<QcBadges />);
  const summary = await screen.findByTestId('ntc-status');
  expect(summary).toHaveTextContent('검토 필요 · NTC 없음');
  expect(summary).not.toHaveTextContent('QPrism1');
  expect(summary).not.toHaveTextContent('콜률');
  expect(screen.queryByRole('button', { name: 'QC 새로고침' })).toBeNull();
});

it('shows the refresh button and the detailed summary in expert mode', async () => {
  render(<QcBadges />);
  await screen.findByTestId('ntc-status');
  act(() => useSettingsStore.getState().setExpertMode(true));
  expect(screen.getByTestId('ntc-status')).toHaveTextContent('콜률');
  expect(screen.getByRole('button', { name: 'QC 새로고침' })).toBeInTheDocument();
});

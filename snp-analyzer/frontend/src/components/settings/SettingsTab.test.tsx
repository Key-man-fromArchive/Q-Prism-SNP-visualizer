import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsTab } from './SettingsTab';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import { getPresets, runClustering } from '@/lib/api';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useNavigationStore } from '@/stores/navigation-store';

vi.mock('@/lib/api', () => ({ getPresets: vi.fn().mockResolvedValue({ presets: [{
  id: 'unsupported', name: 'Unsupported synthetic', builtin: false,
  settings: { algorithm: 'auto', use_rox: false },
}] }), createPreset: vi.fn(), deletePreset: vi.fn(), runClustering: vi.fn() }));

beforeEach(() => {
  useNavigationStore.setState({ status: 'ready' });
  useLanguageStore.setState({ language: 'en' });
  useSettingsStore.setState({ clusterAlgorithm: 'threshold', useRox: true });
});
it('disables analysis during session restoration without invalidating its load', async () => {
  useSessionStore.setState({ sessionId: 'restoring' });
  useAnalysisStore.getState().setSession('restoring', 'u');
  const load = useAnalysisStore.getState().beginRequest('load');
  useNavigationStore.setState({ status: 'restoring' });
  const { container } = render(<SettingsTab />);
  expect(container.querySelector('#run-clustering-btn')).toBeDisabled();
  expect(useAnalysisStore.getState().isCurrent(load)).toBe(true);
  await screen.findByRole('option', { name: 'Unsupported synthetic' });
});

it('rejects unsupported preset algorithms before applying any settings', async () => {
  const { container } = render(<SettingsTab />);
  await screen.findByRole('option', { name: 'Unsupported synthetic' });
  fireEvent.change(container.querySelector('#preset-select')!, { target: { value: 'unsupported' } });
  fireEvent.click(container.querySelector('#apply-preset-btn')!);
  expect(useSettingsStore.getState().clusterAlgorithm).toBe('threshold');
  expect(useSettingsStore.getState().useRox).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent('Unsupported preset algorithm');
});

it.each(['threshold', 'kmeans', undefined] as const)('applies supported preset algorithm %s', async (algorithm) => {
  vi.mocked(getPresets).mockResolvedValue({ presets: [{
    id: 'supported', name: 'Supported synthetic', builtin: false,
    settings: { algorithm, use_rox: false },
  }] });
  const { container } = render(<SettingsTab />);
  await screen.findByRole('option', { name: 'Supported synthetic' });
  fireEvent.change(container.querySelector('#preset-select')!, { target: { value: 'supported' } });
  fireEvent.click(container.querySelector('#apply-preset-btn')!);
  expect(useSettingsStore.getState().clusterAlgorithm).toBe(algorithm ?? 'threshold');
  expect(useSettingsStore.getState().useRox).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('publishes a settings analysis through the shared result owner', async () => {
  useSessionStore.setState({ sessionId: 'settings-session' });
  useAnalysisStore.getState().setSession('settings-session', 'u');
  vi.mocked(runClustering).mockResolvedValue({ algorithm: 'threshold', cycle: 20, assignments: { A1: 'NTC' } });
  const { container } = render(<SettingsTab />);
  fireEvent.click(container.querySelector('#run-clustering-btn')!);
  await waitFor(() => expect(useAnalysisStore.getState().result?.assignments).toEqual({ A1: 'NTC' }));
});

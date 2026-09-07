import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsTab } from './SettingsTab';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import { getPresets } from '@/lib/api';

vi.mock('@/lib/api', () => ({ getPresets: vi.fn().mockResolvedValue({ presets: [{
  id: 'unsupported', name: 'Unsupported synthetic', builtin: false,
  settings: { algorithm: 'auto', use_rox: false },
}] }), createPreset: vi.fn(), deletePreset: vi.fn(), runClustering: vi.fn() }));

beforeEach(() => {
  useLanguageStore.setState({ language: 'en' });
  useSettingsStore.setState({ clusterAlgorithm: 'threshold', useRox: true });
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

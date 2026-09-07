import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProtocolTab } from './ProtocolTab';
import { StatisticsTab } from '../statistics/StatisticsTab';
import { getProtocol, getStatistics } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';
import ko from '@/locales/ko';

vi.mock('@/lib/api', () => ({ getProtocol: vi.fn(), updateProtocol: vi.fn(), getStatistics: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'synthetic' });
  useLanguageStore.setState({ language: 'en' });
});

it('uses the latest protocol error language without refetching on language change', async () => {
  let rejectRequest: (reason: unknown) => void = () => {};
  vi.mocked(getProtocol).mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject; }));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(<ProtocolTab />);
    act(() => useLanguageStore.setState({ language: 'ko' }));
    await act(async () => rejectRequest(new Error('synthetic failure')));
    expect(await screen.findByText(ko.errLoadProtocol)).toBeVisible();
    expect(getProtocol).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});

it('uses the latest statistics fallback error language without refetching', async () => {
  let rejectRequest: (reason: unknown) => void = () => {};
  vi.mocked(getStatistics).mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject; }));
  render(<StatisticsTab />);
  act(() => useLanguageStore.setState({ language: 'ko' }));
  await act(async () => rejectRequest('synthetic non-Error rejection'));
  expect(await screen.findByText(`Error: ${ko.errLoadStatistics}`)).toBeVisible();
  expect(getStatistics).toHaveBeenCalledTimes(1);
});

it('renders a numeric HWE response through its narrowed contract', async () => {
  useSettingsStore.setState({ ploidy: 2 });
  vi.mocked(getStatistics).mockResolvedValue({ total_wells: 4,
    allele_frequency: { total_genotyped: 4, p: 0.5, q: 0.5, n_aa: 1, n_ab: 2, n_bb: 1 },
    genotype_distribution: { Heterozygous: 2 },
    hwe: { chi2: 1, p_value: 0.3, expected_aa: 1, expected_ab: 2, expected_bb: 1, in_hwe: true },
  });
  render(<StatisticsTab />);
  expect(await screen.findByText('χ² = 1.0000')).toBeVisible();
});

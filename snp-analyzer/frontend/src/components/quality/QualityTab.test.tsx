import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QualityTab } from './QualityTab';
import { useSessionStore } from '@/stores/session-store';
import { getQuality } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';

vi.mock('@/lib/api', () => ({ getQuality: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); useSessionStore.setState({ sessionId: 'run-a' }); useLanguageStore.setState({ language: 'en' }); });

it('removes previous session errors when the session is cleared', async () => {
  vi.mocked(getQuality).mockRejectedValue(new Error('run-a private error'));
  render(<QualityTab />);
  expect(await screen.findByText('Failed to fetch quality data')).toBeInTheDocument();
  expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
  vi.mocked(getQuality).mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(getQuality).toHaveBeenCalledTimes(2);
  act(() => useSessionStore.setState({ sessionId: null }));
  expect(screen.queryByText('Failed to fetch quality data')).not.toBeInTheDocument();
  expect(screen.getByText('No quality data available')).toBeInTheDocument();
});

it('does not restart a pending request when only the language changes', () => {
  vi.mocked(getQuality).mockReturnValue(new Promise(() => {}));
  const view = render(<QualityTab />);
  act(() => useLanguageStore.setState({ language: 'ko' }));
  view.rerender(<QualityTab />);
  expect(getQuality).toHaveBeenCalledTimes(1);
});
it.each([
  ['en', false, 'reference normalization off'], ['en', true, 'reference normalization requested'],
  ['ko', false, '참조 정규화 꺼짐'], ['ko', true, '참조 정규화 요청됨'],
] as const)('labels full-curve unversioned scope before navigation: %s/%s', async (language, useRox, expected) => {
  useLanguageStore.setState({ language }); useSettingsStore.setState({ useRox });
  vi.mocked(getQuality).mockResolvedValue({ results: {}, summary: { mean_score: 0, low_quality_count: 0, total_wells: 0 } });
  render(<QualityTab />);
  const scope = await screen.findByTestId('curve-quality-scope');
  expect(scope).toHaveTextContent('run-a');
  expect(scope).toHaveTextContent(expected);
  expect(scope).toHaveTextContent(language === 'en' ? 'unversioned' : '리비전 없음');
  expect(scope).not.toHaveTextContent('result_revision');
});

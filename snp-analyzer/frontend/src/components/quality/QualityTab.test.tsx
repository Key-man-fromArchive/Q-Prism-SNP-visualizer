import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QualityTab } from './QualityTab';
import { useSessionStore } from '@/stores/session-store';
import { getQuality } from '@/lib/api';

vi.mock('@/lib/api', () => ({ getQuality: vi.fn() }));
const labels = vi.hoisted(() => ({ errLoadQuality: 'Failed' }));
vi.mock('@/hooks/use-i18n', () => ({ useI18n: () => ({ t: { ...labels, noQualityData: 'No quality data', loadingQuality: 'Loading quality' } }) }));

beforeEach(() => { vi.clearAllMocks(); useSessionStore.setState({ sessionId: 'run-a' }); });

it('removes previous session errors when the session is cleared', async () => {
  vi.mocked(getQuality).mockRejectedValue(new Error('run-a private error'));
  render(<QualityTab />);
  expect(await screen.findByText('Error: run-a private error')).toBeInTheDocument();
  act(() => useSessionStore.setState({ sessionId: null }));
  expect(screen.queryByText('Error: run-a private error')).not.toBeInTheDocument();
  expect(screen.getByText('No quality data')).toBeInTheDocument();
});

it('does not restart a pending request when only the language changes', () => {
  vi.mocked(getQuality).mockReturnValue(new Promise(() => {}));
  const view = render(<QualityTab />);
  labels.errLoadQuality = '실패';
  view.rerender(<QualityTab />);
  expect(getQuality).toHaveBeenCalledTimes(1);
});

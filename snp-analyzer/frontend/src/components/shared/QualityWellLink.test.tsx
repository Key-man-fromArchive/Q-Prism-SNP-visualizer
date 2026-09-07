import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QualityWellLink } from './QualityWellLink';
import { navigateQualityTarget } from '@/lib/quality-navigation';
import { useNavigationStore } from '@/stores/navigation-store';
vi.mock('@/lib/quality-navigation', () => ({ navigateQualityTarget: vi.fn() }));
it('passes the captured target exactly once and disables duplicate activation while locating', () => {
  useNavigationStore.setState({ qualityNavigating: false });
  const target = { session: 's', well: 'A1', source: 'curve' as const, basis: 'unversioned' as const,
    cycle: 0, useRox: false, marker: null, inputRevision: null, resultRevision: null };
  vi.mocked(navigateQualityTarget).mockImplementation(() => {
    useNavigationStore.setState({ qualityNavigating: true });
    return new Promise(() => {});
  });
  render(<QualityWellLink target={target} />);
  const button = screen.getByRole('button', { name: 'A1' });
  fireEvent.click(button); fireEvent.click(button);
  expect(navigateQualityTarget).toHaveBeenCalledExactlyOnceWith(target);
  expect(button).toBeDisabled();
});

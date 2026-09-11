import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppFooter } from './AppFooter';

const api = vi.hoisted(() => ({ getVersion: vi.fn() }));
vi.mock('@/lib/api', () => api);

describe('AppFooter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('states the running version', async () => {
    api.getVersion.mockResolvedValue({ version: '1.0.0', commit: '', built_at: '' });
    render(<AppFooter />);
    expect(await screen.findByTestId('app-version')).toHaveTextContent('ASG-PCR SNP v1.0.0');
  });

  it('adds the build provenance when the image supplied it', async () => {
    api.getVersion.mockResolvedValue({
      version: '1.0.0', commit: '0123456789ab', built_at: '2026-09-11T00:00:00Z',
    });
    render(<AppFooter />);
    expect(await screen.findByText('0123456789ab')).toBeInTheDocument();
    expect(screen.getByText('2026-09-11T00:00:00Z')).toBeInTheDocument();
  });

  it('says nothing rather than something wrong when the instance cannot answer', async () => {
    api.getVersion.mockRejectedValue(new Error('offline'));
    const { container } = render(<AppFooter />);
    await waitFor(() => expect(api.getVersion).toHaveBeenCalled());
    expect(container.querySelector('footer')).toBeNull();
  });
});

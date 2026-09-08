import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { useLanguageStore } from '@/stores/language-store';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore } from '@/stores/upload-job-store';
import { getSessions, getProjects } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p', name: 'Synthetic project', created_at: '2026-09-07', session_count: 1 }] }),
  getProject: vi.fn().mockResolvedValue({ id: 'p', name: 'Synthetic project', sessions: [], session_ids: ['synthetic'], created_at: '2026-09-07' }),
  getProjectSummary: vi.fn().mockResolvedValue({
    project_id: 'p', project_name: 'Synthetic project',
    plates: [{ session_id: 'synthetic', instrument: 'Synthetic', raw_filename: 'synthetic.csv', num_wells: 30,
      genotypes: { AA: 12, AB: 7, BB: 8, excluded: 3 }, ntc_count: 2, unknown_count: 1, mean_quality: 90 }],
    concordance: { concordant_wells: 0, total_compared: 0, percentage: null },
  }),
}));

it('keeps upload outcomes visible and checks the session list only on the explicit action', async () => {
  useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  const store = useUploadJobStore.getState(); store.reset();
  const ticket = store.begin('u', ['unknown.eds'])!;
  store.update(ticket, 0, { stage: 'unknown', reason: 'response_lost' }); store.finish(ticket);
  try {
    render(<BatchTab />);
    await screen.findByText('Synthetic project');
    expect(screen.getByText('unknown.eds')).toBeVisible();
    const before = vi.mocked(getSessions).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Check sessions in Project' }));
    expect(getSessions).toHaveBeenCalledTimes(before + 1);
  } finally { store.reset(); }
});
it('renders a safe retryable project-list failure instead of raw server details', async () => {
  vi.mocked(getProjects).mockRejectedValueOnce(new Error('private project detail'));
  render(<BatchTab />);
  expect(await screen.findByRole('alert')).not.toHaveTextContent('private project detail');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});
it('discards held project lists when the owner changes', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProjects>>) => void;
  vi.mocked(getProjects).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<BatchTab />);
  await act(async () => { useAuthStore.getState().clearAuth(); resolve({ projects: [{ id: 'old', name: 'Old private project', created_at: '', session_count: 0 }] }); });
  expect(screen.queryByText('Old private project')).not.toBeInTheDocument();
});

it('renders the actual server counts in the project plate row', async () => {
  useLanguageStore.setState({ language: 'en' });
  render(<BatchTab />);
  await screen.findByText('Synthetic project');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  const plateName = await screen.findByText('Synthetic');
  const row = plateName.closest('tr');
  expect(row).not.toBeNull();
  const cells = within(row!).getAllByRole('cell').map((cell) => cell.textContent);
  expect(cells.slice(4, 9)).toEqual(['12', '7', '8', '2', '1']);
  expect(screen.getByText(/Concordance: 0\/0 \(Unavailable\)/)).toBeVisible();
});

it('downloads the same nonzero counts and totals in the actual CSV blob', async () => {
  useLanguageStore.setState({ language: 'en' });
  let captured: Blob | undefined;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { captured = blob; return 'blob:synthetic'; });
    static revokeObjectURL = vi.fn();
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<BatchTab />);
    await screen.findByText('Synthetic project');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText('Synthetic');
    fireEvent.click(screen.getByRole('button', { name: /CSV/i }));
    expect(captured).toBeInstanceOf(Blob);
    const csv = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(captured!);
    });
    expect(csv).toContain('synthetic,synthetic.csv,Synthetic,30,12,7,8,2,1,90.0');
    expect(csv).toContain('TOTAL,,,30,12,7,8,2,1,90.0');
    expect(csv).toContain('Concordance: 0/0 (Unavailable)');
    expect(click).toHaveBeenCalledOnce();
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

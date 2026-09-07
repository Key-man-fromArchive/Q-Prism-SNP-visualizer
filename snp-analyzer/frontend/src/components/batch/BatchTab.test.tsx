import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { useLanguageStore } from '@/stores/language-store';

vi.mock('@/lib/api', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p', name: 'Synthetic project', created_at: '2026-09-07', session_count: 1 }] }),
  getProject: vi.fn().mockResolvedValue({ id: 'p', name: 'Synthetic project', sessions: [], session_ids: ['synthetic'], created_at: '2026-09-07' }),
  getProjectSummary: vi.fn().mockResolvedValue({
    project_id: 'p', project_name: 'Synthetic project',
    plates: [{ session_id: 'synthetic', instrument: 'Synthetic', raw_filename: 'synthetic.csv', num_wells: 30,
      genotypes: { AA: 12, AB: 7, BB: 8, excluded: 3 }, ntc_count: 2, unknown_count: 1, mean_quality: 90 }],
    concordance: { concordant_wells: 0, total_compared: 0, percentage: 0 },
  }),
}));

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
    expect(click).toHaveBeenCalledOnce();
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});

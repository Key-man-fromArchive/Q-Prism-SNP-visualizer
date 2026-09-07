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

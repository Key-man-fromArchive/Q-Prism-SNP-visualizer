import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { useLanguageStore } from '@/stores/language-store';

const plate = vi.hoisted(() => (id: string, extra: Record<string, unknown>) => ({
  session_id: id, instrument: 'StepOnePlus', raw_filename: `${id}.eds`, num_wells: 8,
  genotypes: { AA: 4, AB: 2, BB: 1 }, ntc_count: 1, unknown_count: 0, mean_quality: 90, ...extra,
}));

vi.mock('@/lib/api', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p', name: 'Named project', created_at: '2026-09-07', session_count: 3 }] }),
  getProject: vi.fn().mockResolvedValue({ id: 'p', name: 'Named project', sessions: [], session_ids: [], created_at: '2026-09-07' }),
  getProjectSummary: vi.fn().mockResolvedValue({
    project_id: 'p', project_name: 'Named project',
    plates: [
      plate('named-one', { allele_labels: { fam: 'WT', allele2: 'MT' }, markers: [{ marker_id: 'm1', name: 'rs1', allele_labels: { fam: 'WT', allele2: 'MT' } }] }),
      plate('plain-two', { allele_labels: null, markers: [] }),
      plate('mixed-three', { allele_labels: null, markers: [
        { marker_id: 'a', name: 'rs2', allele_labels: { fam: 'C', allele2: 'T' } },
        { marker_id: 'b', name: 'rs3', allele_labels: { fam: 'G', allele2: 'A' } },
      ] }),
      plate('half-four', { allele_labels: { fam: 'WT', allele2: null } }),
    ],
    concordance: { concordant_wells: 0, total_compared: 0, percentage: null },
  }),
}));

async function rowOf(text: string) {
  const row = (await screen.findByText(text)).closest('tr');
  expect(row).not.toBeNull();
  return within(row!).getAllByRole('cell').map((cell) => cell.textContent);
}

it('shows the marker allele names beside the counts, and the canonical cell without names', async () => {
  useLanguageStore.setState({ language: 'en' });
  render(<BatchTab />);
  await screen.findByText('Named project');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect((await rowOf('named-on')).slice(4, 7)).toEqual(['4WT/WT', '2WT/MT', '1MT/MT']);
  expect((await rowOf('plain-tw')).slice(4, 7)).toEqual(['4', '2', '1']);
  expect((await rowOf('half-fou')).slice(4, 7)).toEqual(['4', '2', '1']);
});

it('does not guess one name set for a plate whose markers disagree', async () => {
  useLanguageStore.setState({ language: 'en' });
  render(<BatchTab />);
  await screen.findByText('Named project');
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect((await rowOf('mixed-th')).slice(4, 7)).toEqual(['4', '2', '1']);
});

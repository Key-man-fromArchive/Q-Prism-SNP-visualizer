import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PlateSetupTab } from './PlateSetupTab';
import { assignManualWells } from '@/lib/manual-commands';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/manual-commands', () => ({ assignManualWells: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(),
  getMarkers: vi.fn().mockResolvedValue({ markers: [] }), getSamples: vi.fn().mockResolvedValue({ samples: {} }),
  getWellTypes: vi.fn().mockResolvedValue({ assignments: { A1: 'Unknown' }, imported_assignments: { A1: 'Unknown' }, manual_assignments: {}, input_revision: 0 }),
  listLayouts: vi.fn().mockResolvedValue({ layouts: [] }), listMarkerCatalog: vi.fn().mockResolvedValue({ entries: [] }),
}));
beforeEach(() => {
  vi.clearAllMocks(); useSessionStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  useSessionStore.setState({ sessionId: 's' });
  useDataStore.getState().setWellTypeAssignments({});
  useLanguageStore.getState().setLanguage('en');
});
it('routes an entire selected row through the shared command without optimistic type mutation or selection loss', async () => {
  let resolve!: (value: boolean) => void;
  vi.mocked(assignManualWells).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<PlateSetupTab />);
  await waitFor(() => expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' }));
  fireEvent.click(screen.getByTestId('row-header-A'));
  fireEvent.click(screen.getByTestId('well-type-ntc'));
  expect(assignManualWells).toHaveBeenCalledWith(Array.from({ length: 12 }, (_, i) => `A${i + 1}`), 'NTC');
  expect(useDataStore.getState().wellTypeAssignments).toEqual({ A1: 'Unknown' });
  await act(async () => resolve(false));
  expect(screen.getByTestId('well-A1')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('well-A12')).toHaveAttribute('aria-pressed', 'true');
});

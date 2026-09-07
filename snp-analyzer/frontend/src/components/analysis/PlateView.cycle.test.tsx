import { act, render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PlateView } from './PlateView';
import { getPlate } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';

vi.mock('@/lib/api', () => ({ getPlate: vi.fn().mockResolvedValue({ cycle: 0, wells: [] }) }));

it('requests a selected actual zero cycle', async () => {
  useSessionStore.setState({ sessionId: 'zero' });
  useSelectionStore.setState({ currentCycle: 0 });
  render(<PlateView />);
  await waitFor(() => expect(getPlate).toHaveBeenCalledWith('zero', 0, expect.any(Boolean), expect.any(String)));
});
it('ignores a plate response after its view unmounts', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getPlate>>) => void;
  vi.mocked(getPlate).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  useSessionStore.setState({ sessionId: 'old' });
  const publish = vi.spyOn(useDataStore.getState(), 'setPlateData');
  const view = render(<PlateView />);
  view.unmount();
  await act(async () => resolve({ cycle: 0, allele2_dye: 'VIC', wells: [] }));
  expect(publish).not.toHaveBeenCalled();
  publish.mockRestore();
});

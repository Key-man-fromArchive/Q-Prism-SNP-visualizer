import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationOverlay } from './AmplificationOverlay';
import { WellDetailPanel } from './WellDetailPanel';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useDataStore } from '@/stores/data-store';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));
vi.mock('@/lib/api', () => ({ getAmplification: vi.fn().mockResolvedValue({
  allele2_dye: 'HEX', curves: [{ well: 'A1', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3] }],
}), getAllAmplification: vi.fn().mockResolvedValue({ allele2_dye: 'HEX', curves: [
  { well: 'A1', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'NTC' },
] }) }));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'synthetic', sessionInfo: {
    session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
    num_cycles: 2, num_wells: 1, has_rox: false,
    data_windows: null, suggested_cycle: null, well_groups: null,
  } });
  useSelectionStore.setState({ selectedWell: null });
  useDataStore.setState({ scatterPoints: [{
    well: 'A1', norm_fam: 2, norm_allele2: 3, raw_fam: 2, raw_allele2: 3, raw_rox: null,
    sample_name: null, auto_cluster: null, manual_type: null,
  }] });
});

it('purges the captured overlay node after React clears its ref', () => {
  const view = render(<AmplificationOverlay />);
  const node = view.container.querySelector('#overlay-plot');
  view.unmount();
  expect(Plotly.purge).toHaveBeenCalledWith(node);
});

it('purges a detail plot first mounted after selection, on deselection', async () => {
  render(<WellDetailPanel />);
  act(() => useSelectionStore.setState({ selectedWell: 'A1' }));
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const node = vi.mocked(Plotly.react).mock.calls[0][0];
  act(() => useSelectionStore.setState({ selectedWell: null }));
  expect(Plotly.purge).toHaveBeenCalledWith(node);
});

it('opens the overlay with typed Plotly axis titles and effective genotype labels', async () => {
  const view = render(<AmplificationOverlay />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  const [, traces, layout] = vi.mocked(Plotly.react).mock.calls[0];
  expect(layout).toMatchObject({ xaxis: { title: { text: 'Cycle' } }, yaxis: { title: { text: 'Norm. FAM RFU' } } });
  expect(traces).toEqual([expect.objectContaining({ name: 'NTC', y: [1, 2] })]);
});

// P2-S2-T1: the Raw data tab mounts a second, plate-wide AmplificationOverlay
// alongside the one that already lives in the Analysis tab (AnalysisTab
// never unmounts -- App.tsx just toggles a `hidden` class -- so both are
// simultaneously in the DOM once the operator opens the Raw data tab).
// Their fixed ids used to be hardcoded, so two instances would have produced
// invalid duplicate-id HTML and made this very file's querySelector('#...')
// lookups ambiguous. idPrefix scopes them; the default ("") is unchanged so
// this file's other assertions and e2e/p4-s2-analysis-tab.spec.ts's
// `#toggle-overlay-btn` locator keep working for the Analysis-tab instance.
it('scopes DOM ids so two concurrently mounted overlays do not collide', async () => {
  const view = render(
    <>
      <AmplificationOverlay />
      <AmplificationOverlay idPrefix="rawdata-" />
    </>
  );

  const plots = view.container.querySelectorAll('[id$="overlay-plot"]');
  expect(plots).toHaveLength(2);
  const ids = Array.from(plots).map((el) => el.id);
  expect(new Set(ids).size).toBe(2);
  expect(ids).toContain('overlay-plot');
  expect(ids).toContain('rawdata-overlay-plot');

  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  fireEvent.click(view.container.querySelector('#rawdata-toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));

  const renderedNodes = vi.mocked(Plotly.react).mock.calls.map((call) => call[0]);
  expect(renderedNodes[0]).not.toBe(renderedNodes[1]);
});

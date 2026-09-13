import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { MarkerScatterPlot } from './MarkerScatterPlot';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useLanguageStore } from '@/stores/language-store';

// P13-NTC-RACE (docs/planning/feedback-2026-09-11/evidence/P13-NTC-RACE.md):
// tests/17-manual-group-and-plate-drag.spec.ts's second test intermittently
// read the NTC corner as `null` right after a fresh marker's `markers-changed`
// remount (AnalysisWorkspace briefly unmounts the single-marker view, then
// mounts a brand-new MultiMarkerAnalysisPanel/MarkerScatterPlot once the
// marker refetch resolves). The investigation traced that to Plotly's own
// async `newPlot` draw call racing the E2E spec's polling helper, NOT to any
// condition in this component ever omitting or delaying the NTC trace itself.
// This test locks in the mechanism the investigation relied on: the NTC
// threshold trace is part of the very FIRST Plotly.newPlot() call this
// component makes, synchronously with mount -- before any cluster/region
// result exists and before any well has an NTC assignment (exactly the state
// a freshly created marker is in the instant it remounts). If a future change
// ever made this trace conditional on `region`/assignments, the corner would
// become genuinely, and unboundedly, unreachable rather than just briefly
// pending Plotly's draw -- turning today's async-render latency into a real
// client-state bug.
vi.mock('plotly.js-dist-min', () => ({
  default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn(), restyle: vi.fn(), relayout: vi.fn(), Plots: { resize: vi.fn() } },
}));
vi.mock('./ScatterViewControls', () => ({ ScatterViewControls: () => null }));

const marker = { id: 'm1', name: 'Marker 1', wells: ['A1', 'A2'], ploidy: 2, threshold_config: undefined };
const points = [
  { well: 'A1', sample_name: null, raw_fam: 1, raw_allele2: 2, raw_rox: null, norm_fam: 1, norm_allele2: 2, auto_cluster: null, manual_type: null },
  { well: 'A2', sample_name: null, raw_fam: 3, raw_allele2: 4, raw_rox: null, norm_fam: 3, norm_allele2: 4, auto_cluster: null, manual_type: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessionId: 'run-a', entryGeneration: 3 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: 'U', role: 'user' } });
  useSettingsStore.getState().resetToDefaults();
  useSelectionStore.setState({ selectedWells: [], focusSelectedWells: false });
  useAnalysisStore.setState({ result: undefined });
  useLanguageStore.setState({ language: 'en' });
  vi.mocked(Plotly.newPlot).mockImplementation(async (node) => { Object.assign(node, { on: vi.fn() }); });
});

it('includes the NTC thresholds trace in the first newPlot call, before any cluster result exists', async () => {
  // No `region` yet -- exactly the state right after a marker is created and
  // `markers-changed` remounts this component, before the debounced
  // `analyzeCurrent` cluster request has resolved (use-settled-analysis.ts's
  // 220ms settle delay hasn't even fired yet).
  render(
    <MarkerScatterPlot
      sessionId="run-a"
      marker={marker}
      region={undefined}
      points={points}
      scatterProvenance={null}
      onBoundariesPersisted={vi.fn()}
    />
  );
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalledTimes(1));
  const [, traces] = vi.mocked(Plotly.newPlot).mock.calls[0] as [unknown, Array<{ name?: string; x?: number[]; y?: number[] }>];
  const ntcTrace = traces.find((t) => t.name === 'NTC thresholds');
  expect(ntcTrace).toBeDefined();
  expect(ntcTrace?.x).toHaveLength(1);
  expect(ntcTrace?.y).toHaveLength(1);
  expect(Number.isFinite(ntcTrace!.x![0])).toBe(true);
  expect(Number.isFinite(ntcTrace!.y![0])).toBe(true);
});

// P13-NTC-RACE: while investigating the corner-not-found flake, a *separate*
// contributing bug surfaced in the E2E harness itself (not app code): the
// trace's `name` is the localized `t.chartNtcThreshold`, and `language-store`
// defaults to `'ko'` ("NTC 임계값"), not `'en'` ("NTC thresholds"). The spec
// only switches to English via `if (await english.isVisible()) await
// english.click()` -- a check with no retry, so it can silently no-op if
// that button hasn't rendered yet at the moment it's read (e.g. right after a
// heavier preceding test, under host contention). When that happens, this
// test's hardcoded `'NTC thresholds'` search never matches *any* trace, for
// the entire run, not just a transient draw window. This test documents that
// this is real, current app behavior (not a hypothetical) so the E2E fix
// stays honest about what it's actually guarding against.
it('names the NTC trace in Korean by default, matching language-store\'s default', async () => {
  useLanguageStore.setState({ language: 'ko' });
  render(
    <MarkerScatterPlot
      sessionId="run-a"
      marker={marker}
      region={undefined}
      points={points}
      scatterProvenance={null}
      onBoundariesPersisted={vi.fn()}
    />
  );
  await waitFor(() => expect(Plotly.newPlot).toHaveBeenCalledTimes(1));
  const [, traces] = vi.mocked(Plotly.newPlot).mock.calls[0] as [unknown, Array<{ name?: string }>];
  expect(traces.some((t) => t.name === 'NTC thresholds')).toBe(false);
  expect(traces.some((t) => t.name === 'NTC 임계값')).toBe(true);
});

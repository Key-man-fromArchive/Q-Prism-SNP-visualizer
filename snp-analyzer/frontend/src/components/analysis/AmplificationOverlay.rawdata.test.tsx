// @TASK P2-S2-T1 - Amplification overlay honesty + color-by + i18n
// @SPEC docs/planning/feedback-2026-09-11/FB-06-rawdata-tab.md#3-3
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Plotly from 'plotly.js-dist-min';
import { AmplificationOverlay } from './AmplificationOverlay';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLanguageStore } from '@/stores/language-store';
import ko from '@/locales/ko';

vi.mock('plotly.js-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

const getAllAmplificationMock = vi.fn();
vi.mock('@/lib/api', () => ({
  getAllAmplification: (...args: unknown[]) => getAllAmplificationMock(...args),
}));

type Trace = { line: { color: string } };

beforeEach(() => {
  vi.clearAllMocks();
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'HEX',
    // Requested normalization (useRox=true, default below) but the backend
    // decided the run has no usable passive reference and stayed raw --
    // exactly the case the overlay must not paper over with the request.
    normalization_applied: false,
    background_mode: 'none',
    curves: [
      { well: 'A1', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'Allele 1 Homo' },
      { well: 'A2', cycles: [1, 2], norm_fam: [3, 4], norm_allele2: [1, 1], effective_type: 'Allele 2 Homo' },
    ],
  });
  useSessionStore.setState({
    sessionId: 'synthetic',
    sessionInfo: {
      session_id: 'synthetic', instrument: 'Synthetic', allele2_dye: 'HEX',
      num_cycles: 2, num_wells: 2, has_rox: true,
      data_windows: null, suggested_cycle: null, well_groups: null,
    },
  });
  useDataStore.setState({ wellTypeAssignments: {} });
  useSettingsStore.setState({ useRox: true, backgroundMode: 'none' });
  useLanguageStore.setState({ language: 'ko' });
});

it('shows the response-echoed processing status, not the requested settings value', async () => {
  const view = render(<AmplificationOverlay />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());

  const status = view.container.querySelector('[data-testid="overlay-processing-status"]');
  expect(status).not.toBeNull();
  // Store requested useRox=true, but the response says it was NOT applied --
  // the badge must report the response, not assert "normalized" from the
  // request the way a naive read of settings-store would.
  expect(status).toHaveAttribute('data-requested', 'true');
  expect(status).toHaveAttribute('data-applied', 'false');
  expect(status!.textContent).toContain(ko.overlayProcessingStatus(true, false));
});

it('does not assert "applied" from the request when the response omits the echo', async () => {
  // Older/hypothetical response shape: normalization_applied is entirely
  // absent, not `false`. useRox (the request) is true. The old
  // `response.normalization_applied ?? useRox` fallback would render
  // "applied: yes" here purely from the request -- the exact bug this
  // task exists to remove.
  getAllAmplificationMock.mockResolvedValue({
    allele2_dye: 'HEX',
    curves: [
      { well: 'A1', cycles: [1, 2], norm_fam: [1, 2], norm_allele2: [2, 3], effective_type: 'Allele 1 Homo' },
    ],
  });

  const view = render(<AmplificationOverlay />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());

  const status = view.container.querySelector('[data-testid="overlay-processing-status"]');
  expect(status).not.toBeNull();
  expect(status).toHaveAttribute('data-requested', 'true');
  // Must be a distinct "not reported" state, never "true" (the request
  // value) and never silently "false" either -- those are different facts.
  expect(status).toHaveAttribute('data-applied', 'unreported');
  expect(status!.textContent).not.toContain(ko.overlayProcessingStatus(true, true));
  expect(status!.textContent).toContain(ko.overlayProcessingStatusUnreported(true));
});

it('renders the toggle button in Korean under the ko locale, not hardcoded English', async () => {
  const view = render(<AmplificationOverlay />);
  const button = view.container.querySelector('#toggle-overlay-btn')!;
  expect(button.textContent).toBe(ko.overlayShow);
  expect(button.textContent).not.toMatch(/Show|Hide/);

  fireEvent.click(button);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalled());
  expect(button.textContent).toBe(ko.overlayHide);
  expect(button.textContent).not.toMatch(/Show|Hide/);
});

it('color-by "solid" strips genotype-driven trace colors without re-fetching', async () => {
  const view = render(<AmplificationOverlay />);
  fireEvent.click(view.container.querySelector('#toggle-overlay-btn')!);
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(1));

  const genotypeTraces = vi.mocked(Plotly.react).mock.calls[0][1] as unknown as Trace[];
  const genotypeColors = new Set(genotypeTraces.map((tr) => tr.line.color));
  expect(genotypeColors.size).toBe(2); // two distinct effective_type values => two colors

  fireEvent.change(view.container.querySelector('#overlay-color-by-select')!, { target: { value: 'solid' } });
  await waitFor(() => expect(Plotly.react).toHaveBeenCalledTimes(2));

  const solidTraces = vi.mocked(Plotly.react).mock.calls[1][1] as unknown as Trace[];
  const solidColors = new Set(solidTraces.map((tr) => tr.line.color));
  expect(solidColors.size).toBe(1);

  // Re-coloring is a pure re-render over the already-fetched curves: no
  // second network round-trip for a display-only pick.
  expect(getAllAmplificationMock).toHaveBeenCalledTimes(1);
});

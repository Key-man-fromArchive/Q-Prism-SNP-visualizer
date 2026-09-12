import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScatterViewControls } from './ScatterViewControls';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';

const baseProps = {
  dataBounds: { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
  labels: { fam: 'FAM', allele2: 'VIC', normalization: 'ROX' },
  ntcCorner: null,
  effectiveNtcCorner: { fam: 0.12, allele2: 0.34 },
  onNtcCornerChange: vi.fn(),
  normalizationApplied: false,
} as const;

it.each(['en', 'ko'] as const)('summarizes inferred thresholds and unlocked axes without applying settings (%s)', language => {
  useLanguageStore.getState().setLanguage(language);
  useSettingsStore.setState({ lockAspect: false, useRox: false, axisMode: 'zero', backgroundMode: 'none' });
  const change = vi.fn();
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 2 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 0.12, allele2: 0.34 }}
    onNtcCornerChange={change} normalizationApplied={false} />);
  const summary = screen.getByTestId('analysis-advanced-settings').querySelector('summary')!;
  expect(summary).toHaveTextContent('FAM ≤0.12');
  expect(summary).toHaveTextContent('VIC ≤0.34');
  expect(summary).toHaveTextContent(language === 'en' ? 'Auto' : '자동');
  // P4-S3-T1 followup: axis mode and lock-aspect used to be repeated here
  // too, but both are already always-visible above (axis-mode select,
  // axis-lock-aspect icon toggle) -- summarizing them again just made an
  // already-long line wrap. The lock-aspect state is asserted on that
  // promoted control instead, right below.
  expect(summary).not.toHaveTextContent(language === 'en' ? 'Independent scales' : '독립 축');
  expect(screen.getByTestId('axis-lock-aspect')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(summary);
  expect(change).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().lockAspect).toBe(false);
  expect(useSettingsStore.getState().useRox).toBe(false);
});

it.each(['en', 'ko'] as const)('summarizes explicit thresholds and locked axes (%s)', language => {
  useLanguageStore.getState().setLanguage(language);
  useSettingsStore.setState({ lockAspect: true, useRox: true, axisMode: 'auto', backgroundMode: 'pre_read' });
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 2 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={{ fam: 0.12, allele2: 0.34 }} effectiveNtcCorner={{ fam: 0.12, allele2: 0.34 }}
    onNtcCornerChange={vi.fn()} normalizationApplied />);
  const summary = screen.getByTestId('analysis-advanced-settings').querySelector('summary')!;
  expect(summary).toHaveTextContent(language === 'en' ? 'Explicit NTC' : '지정 NTC');
  expect(summary).not.toHaveTextContent(language === 'en' ? 'Equal scales' : '동일 축');
  expect(screen.getByTestId('axis-lock-aspect')).toHaveAttribute('aria-pressed', 'true');
});

it('edits and resets the raw NTC axis margins without touching manual bounds', () => {
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ axisMode: 'zero', xMin: -10, yMin: -20 });
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2000, yMin: 0, yMax: 3000 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 1000, allele2: 2000 }}
    onNtcCornerChange={vi.fn()} normalizationApplied={false} />);

  const xOffset = screen.getByTestId('ntc-axis-x-offset');
  const yOffset = screen.getByTestId('ntc-axis-y-offset');
  expect(xOffset).toHaveValue(100);
  expect(yOffset).toHaveValue(100);
  expect(screen.getByTestId('ntc-axis-offset-reset')).toBeDisabled();
  fireEvent.change(xOffset, { target: { value: '250' } });
  fireEvent.change(yOffset, { target: { value: '175' } });
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(250);
  expect(useSettingsStore.getState().yNtcOffsetRaw).toBe(175);
  expect(screen.getByTestId('ntc-axis-offset-reset')).not.toBeDisabled();
  expect(useSettingsStore.getState().xMin).toBe(-10);
  fireEvent.click(screen.getByTestId('ntc-axis-offset-reset'));
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(100);
  expect(useSettingsStore.getState().yNtcOffsetRaw).toBe(100);
});

it('uses the normalized margin pair when normalized display is applied', () => {
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 3 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 1, allele2: 2 }}
    onNtcCornerChange={vi.fn()} normalizationApplied />);
  expect(screen.getByTestId('ntc-axis-x-offset')).toHaveValue(0.1);
  fireEvent.change(screen.getByTestId('ntc-axis-x-offset'), { target: { value: '0.25' } });
  expect(useSettingsStore.getState().xNtcOffsetNormalized).toBe(0.25);
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(100);
});

// P4-S2-T1 (FB-04 §3-2): normalization, axis mode/range, aspect and the drag
// tool are decisions made while looking at the plot, so they must not require
// expanding the collapsed advanced-settings panel to reach. Only NTC quadrant,
// NTC axis offsets and the dosage ceiling stay collapsed -- expert, low
// frequency settings.
it('promotes drag tool, normalization, axis mode and aspect above the collapsed advanced settings', () => {
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls {...baseProps} />);
  const details = screen.getByTestId('analysis-advanced-settings');
  expect(details).not.toHaveAttribute('open');
  for (const testId of [
    'scatter-tool-select', 'scatter-tool-edit',
    'scatter-use-rox', 'normalization-channel-select',
    'axis-mode', 'axis-fit-to-data', 'axis-lock-aspect', 'axis-settings-toggle',
    'scatter-aspect-select',
  ]) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
    expect(within(details).queryByTestId(testId)).toBeNull();
  }
  // The remaining, expert-only controls stay right where they were.
  expect(within(details).getByTestId('ntc-fam-max')).toBeInTheDocument();
  expect(within(details).getByTestId('ntc-axis-x-offset')).toBeInTheDocument();
  expect(within(details).getByTestId('scatter-view-controls')).toBeInTheDocument();
});

// P4-S3-T1 followup (FB-03, canvas-below-the-fold regression): the plot
// header bar used to wrap to 2 rows -- the axis-range group alone spelled
// out "Fit to data"/"Equal x/y scale"/"Axis settings…" in full text. These
// three are now icon-only buttons (same testids, same behavior, label moved
// to title/aria-label) so all 4 groups fit on one row.
it('fits the axes to the data bounds from the icon-only "fit to data" button', () => {
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls {...baseProps} dataBounds={{ xMin: -1, xMax: 5, yMin: -2, yMax: 6 }} />);
  fireEvent.click(screen.getByTestId('axis-fit-to-data'));
  expect(useSettingsStore.getState()).toMatchObject({ xMin: -1, xMax: 5, yMin: -2, yMax: 6 });
});

it('toggles lockAspect from the icon-only "lock aspect" button, disabled in manual axis mode', () => {
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ lockAspect: false, axisMode: 'zero' });
  render(<ScatterViewControls {...baseProps} />);
  const lockButton = screen.getByTestId('axis-lock-aspect');
  expect(lockButton).not.toBeDisabled();
  expect(lockButton).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(lockButton);
  expect(useSettingsStore.getState().lockAspect).toBe(true);
  fireEvent.click(lockButton);
  expect(useSettingsStore.getState().lockAspect).toBe(false);
  act(() => useSettingsStore.setState({ axisMode: 'manual' }));
  expect(screen.getByTestId('axis-lock-aspect')).toBeDisabled();
});

it('lays out the plot header bar controls in 4 named groups on a single row', () => {
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls {...baseProps} />);
  const header = screen.getByTestId('scatter-plot-header');
  expect(header.className).toContain('flex-wrap');
  // Each group now carries its accessible name as a role="group" aria-label
  // instead of a separate visible text line above the controls.
  expect(within(header).getByRole('group', { name: /drag/i })).toBeInTheDocument();
  expect(within(header).getByRole('group', { name: /axis range/i })).toBeInTheDocument();
  expect(within(header).getByRole('group', { name: /aspect ratio/i })).toBeInTheDocument();
});

it('opens axis bounds from the "axis settings" button without picking manual mode first', () => {
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ axisMode: 'zero' });
  render(<ScatterViewControls {...baseProps} />);
  expect(screen.queryByTestId('axis-x-min')).toBeNull();

  fireEvent.click(screen.getByTestId('axis-settings-toggle'));
  expect(useSettingsStore.getState().axisMode).toBe('manual');
  const xMin = screen.getByTestId('axis-x-min');
  expect(xMin).not.toBeDisabled();
  fireEvent.change(xMin, { target: { value: '5' } });
  expect(useSettingsStore.getState().xMin).toBe(5);
  fireEvent.change(screen.getByTestId('axis-y-max'), { target: { value: '9' } });
  expect(useSettingsStore.getState().yMax).toBe(9);
});

it('shows the reference channel name, and disables normalization with a reason when the run has none', () => {
  useSettingsStore.getState().resetToDefaults();
  const { rerender } = render(<ScatterViewControls {...baseProps} hasNormalizationChannel />);
  expect(screen.getByTestId('normalization-channel-select')).toHaveTextContent('ROX');
  expect(screen.getByTestId('scatter-use-rox')).not.toBeDisabled();
  expect(screen.queryByTestId('normalization-channel-reason')).toBeNull();

  rerender(<ScatterViewControls {...baseProps} labels={{ fam: 'FAM', allele2: 'VIC', normalization: null }}
    hasNormalizationChannel={false} />);
  expect(screen.getByTestId('scatter-use-rox')).toBeDisabled();
  expect(screen.getByTestId('normalization-channel-select')).toBeDisabled();
  expect(screen.getByTestId('normalization-channel-reason')).toBeInTheDocument();
});

it('reads and writes the shared scatterAspect setting from its own dropdown', () => {
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls {...baseProps} />);
  const select = screen.getByTestId('scatter-aspect-select');
  expect(select).toHaveValue('4:3');
  fireEvent.change(select, { target: { value: '1:1' } });
  expect(useSettingsStore.getState().scatterAspect).toBe('1:1');
});

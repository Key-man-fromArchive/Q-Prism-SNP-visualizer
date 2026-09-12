// @TASK P12-TOGGLE - Results screen large plot area: scatter <-> curve toggle
// @SPEC docs/planning/feedback-2026-09-11/evidence/P12-PLOT-TOGGLE.md
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ResultsPlotToggle } from './ResultsPlotToggle';

// Real ScatterPlot/AmplificationCurvePanel each render `viewToggle` inside
// their own header (see ScatterViewControls' doc comment) -- these stubs do
// the same, so the toggle only ever exists once in the DOM (only the
// active view receives a non-undefined `viewToggle`).
vi.mock('./ScatterPlot', () => ({
  ScatterPlot: ({ active, viewToggle }: { active?: boolean; viewToggle?: ReactNode }) => (
    <div id="scatter-plot" data-active={active}>
      {viewToggle}
      scatter
    </div>
  ),
}));
vi.mock('./AmplificationCurvePanel', () => ({
  AmplificationCurvePanel: ({ active, viewToggle }: { active?: boolean; viewToggle?: ReactNode }) => (
    <div id="amplification-plot" data-active={active}>
      {viewToggle}
      curve
    </div>
  ),
}));

it('shows the scatter plot and hides the curve by default', () => {
  const { container } = render(<ResultsPlotToggle />);
  expect(screen.getByText('scatter')).toBeVisible();
  expect(screen.getByText('curve')).not.toBeVisible();
  // #scatter-plot exists in the default state (tests/24-responsive.spec.ts:51
  // requires it present and within the 1000px viewport budget).
  expect(container.querySelector('#scatter-plot')).not.toBeNull();
});

it('switches to the curve and hides the scatter plot when the curve tab is clicked', () => {
  render(<ResultsPlotToggle />);
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  expect(screen.getByText('curve')).toBeVisible();
  expect(screen.getByText('scatter')).not.toBeVisible();
});

// @TASK P8-E2E-DEBT (equivalent guarantee) - the curve was once trapped
// inside a wrongly-labeled collapsed <details> (3923909); it must never be
// nested inside any disclosure here either, in either view.
it('never nests either plot inside a <details>/disclosure', () => {
  const { container } = render(<ResultsPlotToggle />);
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  expect(container.querySelector('details')).toBeNull();
});

it('switches back to the scatter plot when the scatter tab is clicked', () => {
  render(<ResultsPlotToggle />);
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  fireEvent.click(screen.getByTestId('plot-view-scatter'));
  expect(screen.getByText('scatter')).toBeVisible();
  expect(screen.getByText('curve')).not.toBeVisible();
});

it('marks the active tab with aria-pressed for both views', () => {
  render(<ResultsPlotToggle />);
  expect(screen.getByTestId('plot-view-scatter')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('plot-view-curve')).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  expect(screen.getByTestId('plot-view-scatter')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('plot-view-curve')).toHaveAttribute('aria-pressed', 'true');
});

it('passes `active` down so each plot can recover a size it computed while hidden', () => {
  render(<ResultsPlotToggle />);
  expect(screen.getByText('scatter')).toHaveAttribute('data-active', 'true');
  expect(screen.getByText('curve')).toHaveAttribute('data-active', 'false');
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  expect(screen.getByText('scatter')).toHaveAttribute('data-active', 'false');
  expect(screen.getByText('curve')).toHaveAttribute('data-active', 'true');
});

// @TASK P12-TOGGLE - only the active view renders the toggle (see this
// file's top comment): passing it to both unconditionally would put two
// "Amplification curve" buttons in the DOM and break every
// getByTestId('plot-view-curve') lookup with a strict-mode multiple match.
it('renders exactly one copy of each toggle button, in whichever view is active', () => {
  render(<ResultsPlotToggle />);
  expect(screen.getAllByTestId('plot-view-scatter')).toHaveLength(1);
  expect(screen.getAllByTestId('plot-view-curve')).toHaveLength(1);
  fireEvent.click(screen.getByTestId('plot-view-curve'));
  expect(screen.getAllByTestId('plot-view-scatter')).toHaveLength(1);
  expect(screen.getAllByTestId('plot-view-curve')).toHaveLength(1);
});

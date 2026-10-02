import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { CycleControl } from './CycleControl';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useLanguageStore } from '@/stores/language-store';

const readLabels = {
  1: { stage: 'pre_read', pcr_cycle: 0, temperature: 25 },
  2: { stage: 'amplification', pcr_cycle: 36, temperature: 40 },
  3: { stage: 'amplification', pcr_cycle: 37, temperature: 40 },
  4: { stage: 'post_read', pcr_cycle: 40, temperature: 25 },
};

function setup(labels: typeof readLabels | null, cycle: number) {
  useSessionStore.setState({ sessionId: 's', sessionInfo: {
    session_id: 's', instrument: 'StepOnePlus', allele2_dye: 'VIC',
    num_cycles: 4, num_wells: 1, has_rox: true, data_windows: null,
    suggested_cycle: 2, well_groups: null, read_labels: labels, default_cycle: 2,
  } });
  useSelectionStore.setState({ currentCycle: cycle, isPlaying: false });
  const generation = useNavigationStore.getState().beginRestore('s');
  useNavigationStore.getState().setAvailableCycles([1, 2, 3, 4]);
  useNavigationStore.getState().complete(generation, { reasons: [], value: {
    session: 's', tab: 'analysis', surface: 'analysis', marker: null, cycle,
  } });
}

beforeEach(() => useLanguageStore.getState().setLanguage('en'));

it('shows the PCR number and temperature for the first screen cycle', () => {
  setup(readLabels, 2);
  render(<CycleControl />);
  expect(screen.getByTestId('cycle-read-label')).toHaveTextContent('Amplification 1/2 · PCR 36 · 40°C');
});

it('shows no read label for runs without declared reads', () => {
  setup(null, 2);
  render(<CycleControl />);
  expect(screen.queryByTestId('cycle-read-label')).toBeNull();
});

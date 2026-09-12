import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtocolThermalProfile } from './ProtocolThermalProfile';
import { useLanguageStore } from '@/stores/language-store';
import type { ProtocolStep } from '@/types/api';

function makeStep(overrides: Partial<ProtocolStep>): ProtocolStep {
  return {
    step: 1,
    temperature: 60,
    duration_sec: 30,
    cycles: 1,
    label: 'Step',
    phase: '',
    goto_label: '',
    plate_read: false,
    temp_increment: null,
    read_channels: [],
    ...overrides,
  };
}

beforeEach(() => { useLanguageStore.getState().setLanguage('en'); });

describe('ProtocolThermalProfile', () => {
  it('renders nothing for an empty protocol', () => {
    const { container } = render(<ProtocolThermalProfile steps={[]} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('draws exactly one segment per step, in step order (not real time)', () => {
    const steps = [
      makeStep({ step: 1, label: 'Initial Denaturation', duration_sec: 300 }),
      makeStep({ step: 2, label: 'Denaturation', duration_sec: 20 }),
      makeStep({ step: 3, label: 'Annealing', duration_sec: 5 }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-step-3')).toBeInTheDocument();
  });

  // The single most important regression guard for this component: the
  // marker is keyed to the `plate_read` field, never to substrings like
  // "read" or "data collection" inside the free-text `label`.
  it('places the read marker by plate_read, ignoring what the label says', () => {
    const steps = [
      makeStep({ step: 1, label: 'Totally unrelated wording', plate_read: true }),
      makeStep({ step: 2, label: 'Data Collection Post-Read', plate_read: false }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-read-marker-1')).toBeInTheDocument();
    expect(screen.queryByTestId('protocol-read-marker-2')).not.toBeInTheDocument();
  });

  it('shows a signed touchdown indicator only for steps with a temp_increment', () => {
    const steps = [
      makeStep({ step: 1, temp_increment: -0.6, cycles: 10 }),
      makeStep({ step: 2, temp_increment: null }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-touchdown-1')).toHaveTextContent('-0.6');
    expect(screen.queryByTestId('protocol-touchdown-2')).not.toBeInTheDocument();
  });

  it('formats a positive touchdown increment with an explicit sign', () => {
    const steps = [makeStep({ step: 1, temp_increment: 0.6, cycles: 5 })];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-touchdown-1')).toHaveTextContent('+0.6');
  });

  it('gives the diagram an accessible name/description instead of being purely decorative', () => {
    const steps = [makeStep({ step: 1 })];
    render(<ProtocolThermalProfile steps={steps} />);
    const svg = screen.getByTestId('protocol-thermal-profile');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.querySelector('title')).not.toBeNull();
  });

  it('groups repeated steps into a phase band with a x-N cycle badge', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10 }),
      makeStep({ step: 2, phase: 'Amplification 1', cycles: 10 }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-phase-band-Amplification 1-0')).toHaveTextContent('10');
  });
});

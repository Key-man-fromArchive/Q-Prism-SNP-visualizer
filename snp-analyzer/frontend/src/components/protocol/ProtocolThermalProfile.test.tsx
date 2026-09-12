import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtocolThermalProfile } from './ProtocolThermalProfile';
import { estimateTextWidth, fitPhaseLabel, LABEL_HORIZONTAL_PADDING_PX } from './protocol-thermal-label-fit';
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

  // A band's steps normally share one cycle count (every parser emits one
  // GOTO group per stage), but manual editing of a single step's `cycles`
  // field can desynchronize them -- printing "x 10" in that case would
  // assert a single count that is no longer true for the whole band.
  it('does not print a single x-N cycle count when a band\'s steps disagree on cycles', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10 }),
      makeStep({ step: 2, phase: 'Amplification 1', cycles: 12 }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    const band = screen.getByTestId('protocol-phase-band-Amplification 1-0');
    expect(band).not.toHaveTextContent('×10');
    expect(band).not.toHaveTextContent('×12');
  });

  // --- P9: narrow-band label overlap -------------------------------------
  // The production regression (FB-05/P9): a one-step-wide band whose phase
  // name is long enough to overflow its own band steals space from its
  // neighbors, and adjacent labels end up interleaved/truncated into each
  // other (observed: "Pre-realInitial DenatAmplification 1 (Touchdown) ...").
  // `fitPhaseLabel` is the fix's unit of work: given a band's own pixel
  // width, it must never hand back a label wider than that width, so a
  // label can never spill into a neighboring band.
  describe('fitPhaseLabel (band-width label fitting)', () => {
    it('returns the full label unmodified when it comfortably fits', () => {
      const label = fitPhaseLabel('Post-read', '', 300);
      expect(label).toBe('Post-read');
    });

    it('never returns a label whose estimated width exceeds the available width', () => {
      const cases: Array<[string, string, number]> = [
        ['Pre-read', '', 72],
        ['Initial Denaturation', '', 72],
        ['Amplification 1 (Touchdown)', ' ×10', 72],
        ['Amplification 2', ' ×13', 144],
        ['Post-read', '', 20],
        ['Post-read', '', 6],
      ];
      for (const [phase, cyclesSuffix, widthPx] of cases) {
        const label = fitPhaseLabel(phase, cyclesSuffix, widthPx);
        if (label === null) continue; // hidden: no text drawn, so no overflow possible
        expect(estimateTextWidth(label)).toBeLessThanOrEqual(widthPx);
      }
    });

    it('falls back to an abbreviation before truncating, so real words survive when they fit', () => {
      // "Initial Denaturation" (21 chars) does not fit in one step-width
      // (72px), but a recognizable abbreviation does.
      const label = fitPhaseLabel('Initial Denaturation', '', 72);
      expect(label).not.toBeNull();
      expect(label).not.toBe('Initial Denaturation');
      expect(estimateTextWidth(label as string)).toBeLessThanOrEqual(72);
    });

    it('truncates with an ellipsis, never mid-word-silently-concatenated, when abbreviation still overflows', () => {
      const label = fitPhaseLabel('Amplification 1 (Touchdown)', ' ×10', 40);
      expect(label).not.toBeNull();
      expect(label as string).toMatch(/…$/);
    });

    it('hides the label (returns null) rather than overflowing when the band is too narrow for any text', () => {
      const label = fitPhaseLabel('Initial Denaturation', '', 4);
      expect(label).toBeNull();
    });

    it('does not choke on a zero or negative available width', () => {
      expect(fitPhaseLabel('Post-read', '', 0)).toBeNull();
      expect(fitPhaseLabel('Post-read', '', -10)).toBeNull();
    });
  });

  it('keeps every rendered phase-band label within that band\'s own horizontal span, even with a narrow one-step band next to long phase names (regression: production overlap)', () => {
    // Mirrors the reported production fixture: an 8-phase EDS touchdown
    // protocol where several phases are exactly one step wide.
    const steps = [
      makeStep({ step: 1, phase: 'Pre-read', cycles: 1 }),
      makeStep({ step: 2, phase: 'Initial Denaturation', cycles: 1 }),
      ...Array.from({ length: 10 }, (_, i) =>
        makeStep({ step: 3 + i, phase: 'Amplification 1 (Touchdown)', cycles: 10, temp_increment: -0.5 })),
      ...Array.from({ length: 13 }, (_, i) =>
        makeStep({ step: 13 + i, phase: 'Amplification 2', cycles: 13 })),
      makeStep({ step: 26, phase: 'Post-read', cycles: 1 }),
    ];
    const { container } = render(<ProtocolThermalProfile steps={steps} />);

    const bandGroups = Array.from(container.querySelectorAll('[data-testid^="protocol-phase-band-"]'));
    expect(bandGroups.length).toBeGreaterThan(0);

    const spans = bandGroups.map((g) => {
      const rect = g.querySelector('rect');
      const x0 = Number(rect?.getAttribute('x'));
      const w = Number(rect?.getAttribute('width'));
      const text = g.querySelector('text');
      return { x0, x1: x0 + w, text };
    });

    for (const { x0, x1, text } of spans) {
      if (!text) continue; // label hidden for this band: nothing to overflow
      const labelWidth = estimateTextWidth(text.textContent ?? '');
      const labelStart = x0;
      const labelEnd = x1;
      // The label's estimated width must be no wider than the band it is
      // drawn in, i.e. it cannot spill past either edge of its own band.
      expect(labelWidth).toBeLessThanOrEqual(labelEnd - labelStart + 0.01);
    }
  });

  it('keeps the full phase name and cycle count accessible even when the on-diagram label is abbreviated, truncated, or hidden', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Pre-read', cycles: 1 }),
      makeStep({ step: 2, phase: 'Initial Denaturation', cycles: 1 }),
      ...Array.from({ length: 10 }, (_, i) =>
        makeStep({ step: 3 + i, phase: 'Amplification 1 (Touchdown)', cycles: 10, temp_increment: -0.5 })),
    ];
    const { container } = render(<ProtocolThermalProfile steps={steps} />);
    // Regardless of what got drawn on the diagram itself, the full,
    // untruncated band information must exist somewhere in the accessible
    // tree (screen-reader-only legend and/or per-band <title> tooltip).
    expect(container).toHaveTextContent('Initial Denaturation');
    expect(container).toHaveTextContent('Amplification 1 (Touchdown)');
    expect(container).toHaveTextContent('10');
  });

  it('does not break for a single-step, single-band protocol (narrowest possible case)', () => {
    const steps = [makeStep({ step: 1, phase: 'Post-read', cycles: 1 })];
    const { container } = render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-phase-band-Post-read-0')).toBeInTheDocument();
    expect(container).toHaveTextContent('Post-read');
  });

  it('keeps existing data-testids stable for phase bands, steps and read markers', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10, plate_read: true }),
      makeStep({ step: 2, phase: 'Amplification 1', cycles: 10 }),
    ];
    render(<ProtocolThermalProfile steps={steps} />);
    expect(screen.getByTestId('protocol-phase-band-Amplification 1-0')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-step-2')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-read-marker-1')).toBeInTheDocument();
  });

  // --- P10 follow-up: adjacent band labels must not visually touch --------
  // P9 guaranteed a label never overflows its OWN band, but two adjacent
  // one-step bands each filled right up to that limit still end up with
  // their text only ~4px apart (evidence:
  // P9-THERMAL-LABELS-after-harsh-wide-light.png -- "Ampl. 1 (TD…Ampl.
  // 2 ×1…" reads as one run-on string). Fitting must leave real breathing
  // room, not just avoid outright overflow.
  it('leaves a visible gap between two adjacent full-width band labels, not just non-overflow', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10 }),
      makeStep({ step: 2, phase: 'Amplification 2', cycles: 13 }),
    ];
    const { container } = render(<ProtocolThermalProfile steps={steps} />);
    const bandGroups = Array.from(container.querySelectorAll('[data-testid^="protocol-phase-band-"]'));
    const [first, second] = bandGroups.map((g) => {
      const rect = g.querySelector('rect');
      const text = g.querySelector('text');
      const x0 = Number(rect?.getAttribute('x'));
      const width = Number(rect?.getAttribute('width'));
      const labelWidth = text ? estimateTextWidth(text.textContent ?? '') : 0;
      return { center: x0 + width / 2, labelWidth };
    });
    const firstLabelRightEdge = first.center + first.labelWidth / 2;
    const secondLabelLeftEdge = second.center - second.labelWidth / 2;
    expect(secondLabelLeftEdge - firstLabelRightEdge).toBeGreaterThanOrEqual(12);
  });

  it('keeps at least 16px of the padding budget for horizontal clearance, split across both sides of a label', () => {
    // 8px clearance per side is the minimum that reads as a visible gap
    // rather than touching text at this diagram's font size (10px,
    // weight 600) -- see the adjacent-label test above and
    // evidence/P10-PROTOCOL-UI.md for the before/after screenshots this
    // was checked against.
    expect(LABEL_HORIZONTAL_PADDING_PX).toBeGreaterThanOrEqual(16);
  });
});

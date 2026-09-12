import { describe, expect, it } from 'vitest';
import { groupPhaseBands, getPhaseColor } from './protocol-phase-groups';
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

describe('groupPhaseBands', () => {
  it('groups contiguous same-phase steps into one band', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10 }),
      makeStep({ step: 2, phase: 'Amplification 1', cycles: 10 }),
    ];
    const bands = groupPhaseBands(steps);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toMatchObject({ phase: 'Amplification 1', startIndex: 0, endIndex: 1, cycles: 10, cyclesVary: false });
  });

  it('does not merge non-contiguous same-phase steps into one band', () => {
    const steps = [
      makeStep({ step: 1, phase: 'A' }),
      makeStep({ step: 2, phase: '' }),
      makeStep({ step: 3, phase: 'A' }),
    ];
    const bands = groupPhaseBands(steps);
    expect(bands).toHaveLength(2);
  });

  it('skips steps with an empty phase entirely', () => {
    const steps = [makeStep({ step: 1, phase: '' })];
    expect(groupPhaseBands(steps)).toHaveLength(0);
  });

  it('flags a band whose steps do not all share the same cycle count', () => {
    const steps = [
      makeStep({ step: 1, phase: 'Amplification 1', cycles: 10 }),
      makeStep({ step: 2, phase: 'Amplification 1', cycles: 12 }),
    ];
    const bands = groupPhaseBands(steps);
    expect(bands).toHaveLength(1);
    expect(bands[0].cyclesVary).toBe(true);
  });

  it('does not break on a single-step protocol', () => {
    const bands = groupPhaseBands([makeStep({ step: 1, phase: 'Post-read', cycles: 1 })]);
    expect(bands).toEqual([{ phase: 'Post-read', startIndex: 0, endIndex: 0, cycles: 1, cyclesVary: false }]);
  });

  it('does not break on an empty protocol', () => {
    expect(groupPhaseBands([])).toEqual([]);
  });
});

describe('getPhaseColor (P0-T0.2 value lock, preserved verbatim after the move)', () => {
  it('returns the exact pre-refactor hex for every named phase, amplification index and the fallback', () => {
    expect(getPhaseColor('Pre-read')).toEqual({ border: '#3b82f6', label: '#2563eb' });
    expect(getPhaseColor('Initial Denaturation')).toEqual({ border: '#ef4444', label: '#dc2626' });
    expect(getPhaseColor('Post-read')).toEqual({ border: '#10b981', label: '#059669' });
    expect(getPhaseColor('Amplification 1')).toEqual({ border: '#f59e0b', label: '#d97706' });
    expect(getPhaseColor('Amplification 5')).toEqual(getPhaseColor('Amplification 1')); // wraps mod 4
    expect(getPhaseColor('Unrecognized Phase')).toEqual({ border: '#94a3b8', label: '#64748b' });
  });
});

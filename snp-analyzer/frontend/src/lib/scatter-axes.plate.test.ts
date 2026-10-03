import { describe, expect, it } from 'vitest';
import { plateRange } from './scatter-axes';

describe('plateRange (same axes for every marker and read)', () => {
  const plate = { xMin: 3800, xMax: 11700, yMin: 2300, yMax: 3400 };
  const manual = { xMin: 1, xMax: 2, yMin: 3, yMax: 4 };

  it('manual wins', () => {
    expect(plateRange('manual', plate, manual, null)).toEqual(manual);
  });

  it('auto fits the plate extent', () => {
    const a = plateRange('auto', plate, manual, null);
    expect(a.xMin).toBeLessThanOrEqual(3800);
    expect(a.xMax).toBeGreaterThanOrEqual(11700);
    expect(a.yMax).toBeGreaterThanOrEqual(3400);
  });

  it('zero (NTC origin) mode is anchored at 0 and independent of any per-read origin', () => {
    const z = plateRange('zero', plate, manual, null);
    expect(z.xMin).toBe(0);
    expect(z.yMin).toBe(0);
    expect(z.xMax).toBeGreaterThanOrEqual(11700);
  });

  it('stretches only for an editing corner outside the range', () => {
    const z = plateRange('auto', plate, manual, { fam: 20000, allele2: 9000 });
    expect(z.xMax).toBeGreaterThanOrEqual(20000);
    expect(z.yMax).toBeGreaterThanOrEqual(9000);
    expect(plateRange('auto', plate, manual, { fam: 5000, allele2: 2500 }))
      .toEqual(plateRange('auto', plate, manual, null));
  });
});

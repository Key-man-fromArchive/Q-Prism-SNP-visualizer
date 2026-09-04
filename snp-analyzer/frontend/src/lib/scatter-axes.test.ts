import { describe, expect, it } from 'vitest';
import { axisRangeLayout, dataBounds, roundBound, visibleBounds } from './scatter-axes';

/** The real plate this module exists for: 1-2_admin_2026-09-03 16-14-11_
 *  783BR20183.pcrd at cycle 5. x spans 3804..11671 and y only 2331..3369, so a
 *  tight autorange puts (0, 0) off-canvas and stretches x against y by ~8:1. */
const PLATE = [
  { fam: 3803.8, allele2: 2331.4 },
  { fam: 4400.0, allele2: 2650.0 },
  { fam: 9000.0, allele2: 2493.2 },
  { fam: 11671.1, allele2: 2591.7 },
  { fam: 4043.8, allele2: 3369.1 },
];
const NTC_CORNER = { fam: 5040.0, allele2: 2710.0 };

describe('dataBounds', () => {
  it('covers the data and the NTC corner', () => {
    const bounds = dataBounds(PLATE, { fam: 20000, allele2: 9000 });
    // The corner is draggable, so it can never be outside the plot it has to
    // be grabbed in.
    expect(bounds.xMax).toBeGreaterThanOrEqual(20000);
    expect(bounds.yMax).toBeGreaterThanOrEqual(9000);
  });

  it('gives a degenerate axis a usable width', () => {
    const bounds = dataBounds([{ fam: 5, allele2: 5 }, { fam: 5, allele2: 5 }]);
    expect(bounds.xMax).toBeGreaterThan(bounds.xMin);
    expect(bounds.yMax).toBeGreaterThan(bounds.yMin);
  });

  it('falls back to a unit box with no points', () => {
    expect(dataBounds([])).toEqual({ xMin: 0, xMax: 1, yMin: 0, yMax: 1 });
  });
});

describe('visibleBounds', () => {
  const data = dataBounds(PLATE, NTC_CORNER);
  const manual = { xMin: -1, xMax: 20000, yMin: -2, yMax: 9000 };

  it('zero mode includes the origin, which is the whole point', () => {
    const bounds = visibleBounds('zero', data, manual);
    expect(bounds.xMin).toBe(0);
    expect(bounds.yMin).toBe(0);
    // ... and does not clip the data away to get there.
    expect(bounds.xMax).toBeGreaterThan(11671);
  });

  it('zero mode still shows values below zero', () => {
    // A background subtraction can push a well negative; hiding it would be
    // worse than not anchoring at all.
    const negative = dataBounds([{ fam: -500, allele2: -200 }, { fam: 100, allele2: 50 }]);
    const bounds = visibleBounds('zero', negative, manual);
    expect(bounds.xMin).toBeLessThan(-500);
    expect(bounds.yMin).toBeLessThan(-200);
  });

  it('auto mode stays tight around the data', () => {
    expect(visibleBounds('auto', data, manual)).toEqual(data);
  });

  it('manual mode is exactly what the operator typed', () => {
    expect(visibleBounds('manual', data, manual)).toEqual(manual);
  });
});

describe('axisRangeLayout', () => {
  const bounds = { xMin: 0, xMax: 12000, yMin: 0, yMax: 3500 };

  it('anchors at zero without pinning an explicit range', () => {
    const { xaxis, yaxis } = axisRangeLayout('zero', false, bounds);
    expect(xaxis.rangemode).toBe('tozero');
    expect(yaxis.rangemode).toBe('tozero');
    expect(xaxis.autorange).toBe(true);
    expect(xaxis.range).toBeUndefined();
  });

  it('ties y to x when the aspect is locked, so a ratio is a real angle', () => {
    const { yaxis } = axisRangeLayout('zero', true, bounds);
    expect(yaxis.scaleanchor).toBe('x');
    expect(yaxis.scaleratio).toBe(1);
  });

  it('drops the aspect lock in manual mode rather than overriding a typed range', () => {
    // Plotly satisfies scaleanchor by rewriting one of the two ranges, which
    // would leave the number inputs describing a plot that is not on screen.
    const { xaxis, yaxis } = axisRangeLayout('manual', true, bounds);
    expect(xaxis.range).toEqual([0, 12000]);
    expect(yaxis.range).toEqual([0, 3500]);
    expect(yaxis.scaleanchor).toBeUndefined();
  });

  it('auto mode ranges nothing itself', () => {
    const { xaxis, yaxis } = axisRangeLayout('auto', false, bounds);
    expect(xaxis.autorange).toBe(true);
    expect(xaxis.rangemode).toBe('normal');
    expect(yaxis.range).toBeUndefined();
  });
});

describe('roundBound', () => {
  it('keeps raw RFU readable and small normalized values precise', () => {
    expect(roundBound(11671.05)).toBe(11671);
    expect(roundBound(2.34567)).toBe(2.35);
    expect(roundBound(0.093951)).toBe(0.094);
    expect(roundBound(0)).toBe(0);
    expect(roundBound(Number.NaN)).toBe(0);
  });
});

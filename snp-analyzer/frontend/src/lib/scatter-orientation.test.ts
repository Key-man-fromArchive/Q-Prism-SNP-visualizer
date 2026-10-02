import { describe, expect, it } from 'vitest';
import { fromPlot, ntcDragRelayout, ntcThresholdShapes, orientBounds, orientShape, toPlot } from './scatter-axes';

describe('scatter orientation helpers', () => {
  it('maps a fam/allele2 pair to plot x/y and back for both orientations', () => {
    const p = { fam: 10, allele2: 3 };
    expect(toPlot(p, 'fam_x')).toEqual({ x: 10, y: 3 });
    expect(toPlot(p, 'allele2_x')).toEqual({ x: 3, y: 10 });
    expect(fromPlot({ x: 3, y: 10 }, 'allele2_x')).toEqual(p);
    expect(fromPlot({ x: 10, y: 3 }, 'fam_x')).toEqual(p);
  });

  it('swaps bounds only when allele2 is on x, and swapping twice is the identity', () => {
    const b = { xMin: 1, xMax: 2, yMin: 3, yMax: 4 };
    expect(orientBounds(b, 'fam_x')).toEqual(b);
    expect(orientBounds(b, 'allele2_x')).toEqual({ xMin: 3, xMax: 4, yMin: 1, yMax: 2 });
    expect(orientBounds(orientBounds(b, 'allele2_x'), 'allele2_x')).toEqual(b);
  });

  it('swaps shape coordinates', () => {
    const shape = { type: 'line', x0: 1, y0: 2, x1: 3, y1: 4, line: { width: 1 } };
    expect(orientShape(shape, 'fam_x')).toEqual(shape);
    expect(orientShape(shape, 'allele2_x')).toEqual({ ...shape, x0: 2, y0: 1, x1: 4, y1: 3 });
  });

  it('addresses the NTC edit shapes of either orientation when dragging the corner', () => {
    const corner = { fam: 5, allele2: 7 };
    expect(ntcDragRelayout(2, corner, 'fam_x')).toEqual({
      'shapes[2].x1': 5, 'shapes[2].y1': 7,
      'shapes[3].x0': 5, 'shapes[3].x1': 5,
      'shapes[4].y0': 7, 'shapes[4].y1': 7,
    });
    expect(ntcDragRelayout(2, corner, 'allele2_x')).toEqual({
      'shapes[2].x1': 7, 'shapes[2].y1': 5,
      'shapes[3].y0': 5, 'shapes[3].y1': 5,
      'shapes[4].x0': 7, 'shapes[4].x1': 7,
    });
  });

  it('follows the swapped NTC shapes that ntcThresholdShapes draws', () => {
    const bounds = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };
    const shapes = ntcThresholdShapes(true, { fam: 5, allele2: 7 }, bounds, { x: 10, y: 10 })
      .map((s) => orientShape(s, 'allele2_x'));
    const patch = ntcDragRelayout(0, { fam: 6, allele2: 8 }, 'allele2_x');
    expect(shapes[0]).toMatchObject({ x1: 7, y1: 5 });
    expect(patch['shapes[0].x1']).toBe(8);
    expect(shapes[1]).toMatchObject({ y0: 5, y1: 5 });
    expect(patch['shapes[1].y0']).toBe(6);
    expect(shapes[2]).toMatchObject({ x0: 7, x1: 7 });
    expect(patch['shapes[2].x0']).toBe(8);
  });
});

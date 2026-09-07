import { expect, it } from 'vitest';
import { plateAnalysisScope } from './plate-analysis-scope';

it('keeps whole-plate mode for no markers or empty local drafts', () => {
  for (const markers of [[], [{ wells: [] }]]) {
    expect(plateAnalysisScope(['A1', 'H12'], markers, { H12: 'Omit' })).toEqual({ mode: 'whole', total: 2, unassigned: 0, empty: 0, omit: 1, eligible: 1 });
  }
});
it.each(['H12', 'P24'])('counts only actual input wells, deduplicating marker overlaps (%s)', last => {
  const wells = ['A1', 'A2', last];
  const types = { A2: 'Empty', [last]: 'Omit' };
  expect(plateAnalysisScope(wells, [{ wells: ['A1', 'A2', 'B3'] }, { wells: ['A1'] }], types))
    .toEqual({ mode: 'markers', total: 3, unassigned: 1, empty: 1, omit: 1, eligible: 1 });
});
it('never infers inventory from metadata or turns Unknown into exclusion', () => {
  expect(plateAnalysisScope(undefined, [{ wells: ['A1'] }], {})).toBeNull();
  expect(plateAnalysisScope(['A1', 'A2'], [], { A1: 'Unknown', A2: 'Unknown' })?.eligible).toBe(2);
  expect(plateAnalysisScope([], [], {})).toMatchObject({ total: 0, eligible: 0 });
});

it.each([[8, 12], [16, 24]])('counts the complete %ix%i inventory with overlapping role exclusions', (rows, cols) => {
  const wells = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => `${String.fromCharCode(65 + row)}${col + 1}`)).flat();
  const types = { A1: 'Empty', A2: 'Omit', B1: 'Omit' };
  expect(plateAnalysisScope(wells, [], types)).toMatchObject({ total: rows * cols, unassigned: 0, eligible: rows * cols - 3 });
  expect(plateAnalysisScope(wells, [{ wells: wells.slice(0, cols) }], types))
    .toMatchObject({ total: rows * cols, unassigned: rows * cols - cols, eligible: cols - 2, empty: 1, omit: 2 });
  expect(plateAnalysisScope(wells, [{ wells: wells.slice(0, cols) }, { wells: wells.slice(cols, cols * 2) }], types))
    .toMatchObject({ unassigned: rows * cols - cols * 2, eligible: cols * 2 - 3 });
});

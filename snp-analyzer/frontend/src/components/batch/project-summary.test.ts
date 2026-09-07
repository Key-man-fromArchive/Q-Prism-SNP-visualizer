import { expect, it } from 'vitest';
import { projectGenotypeCounts } from './project-summary';

it('uses server genotypes and separate control counts for tables and CSV', () => {
  expect(projectGenotypeCounts({ genotypes: { AA: 12, AB: 7, BB: 8, excluded: 3 }, ntc_count: 2, unknown_count: 1 }))
    .toEqual({ AA: 12, AB: 7, BB: 8, NTC: 2, Unknown: 1 });
});

it('retains zeros for a missing plate with empty genotype counts', () => {
  expect(projectGenotypeCounts({ genotypes: {}, ntc_count: 0, unknown_count: 0 }))
    .toEqual({ AA: 0, AB: 0, BB: 0, NTC: 0, Unknown: 0 });
});

import { expect, it } from 'vitest';
import { plateAlleleLabels, projectGenotypeCounts, projectGenotypeNames } from './project-summary';

it('names the three diploid classes only when both allele names are present', () => {
  expect(projectGenotypeNames({ fam: 'WT', allele2: 'MT' })).toEqual(['WT/WT', 'WT/MT', 'MT/MT']);
  expect(projectGenotypeNames({ fam: 'WT', allele2: null })).toBeNull();
  expect(projectGenotypeNames(null)).toBeNull();
});

it('uses the plate names, else one name set shared by every marker, else none', () => {
  const wt = { fam: 'WT', allele2: 'MT' };
  expect(plateAlleleLabels({ allele_labels: wt })).toEqual(wt);
  expect(plateAlleleLabels({ allele_labels: null, markers: [{ marker_id: 'a', name: 'a', allele_labels: wt }, { marker_id: 'b', name: 'b', allele_labels: { ...wt } }] })).toEqual(wt);
  expect(plateAlleleLabels({ allele_labels: null, markers: [{ marker_id: 'a', name: 'a', allele_labels: wt }, { marker_id: 'b', name: 'b', allele_labels: null }] })).toBeNull();
  expect(plateAlleleLabels({})).toBeNull();
});

it('uses server genotypes and separate control counts for tables and CSV', () => {
  expect(projectGenotypeCounts({ genotypes: { AA: 12, AB: 7, BB: 8, excluded: 3 }, ntc_count: 2, unknown_count: 1 }))
    .toEqual({ AA: 12, AB: 7, BB: 8, NTC: 2, Unknown: 1 });
});

it('retains zeros for a missing plate with empty genotype counts', () => {
  expect(projectGenotypeCounts({ genotypes: {}, ntc_count: 0, unknown_count: 0 }))
    .toEqual({ AA: 0, AB: 0, BB: 0, NTC: 0, Unknown: 0 });
});

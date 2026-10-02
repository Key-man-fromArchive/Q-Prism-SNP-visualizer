import { expect, it } from 'vitest';
import { projectCsv, projectCsvCell, projectDownloadName } from './project-export';
import type { ProjectSummaryResponse } from '@/types/api';
import type { NamedProjectSummary } from './project-summary';
it.each(['=SUM(A1)', '+formula', '-formula', '@formula', '  =formula'])('neutralizes spreadsheet formula %s', text => {
  expect(projectCsvCell(text)).toBe(`'${text}`);
});
it('exports a truthful localized unavailable value for a non-comparable project', () => {
  const summary: ProjectSummaryResponse = {
    project_id: 'p', project_name: 'Single plate', plates: [],
    concordance: { concordant_wells: 0, total_compared: 0, percentage: null },
  };
  expect(projectCsv(summary, '산출 불가')).toContain('Concordance: 0/0 (산출 불가)');
});
it('exports the server concordance percentage when enough wells are comparable', () => {
  const summary: ProjectSummaryResponse = {
    project_id: 'p', project_name: 'Two plate project',
    plates: [
      { session_id: 'a', raw_filename: 'run-a.pcrd', instrument: 'CFX', num_wells: 8, genotypes: { AA: 4, AB: 2, BB: 1 }, ntc_count: 1, unknown_count: 0, mean_quality: 91.2 },
      { session_id: 'b', raw_filename: 'run-b.pcrd', instrument: 'CFX', num_wells: 8, genotypes: { AA: 4, AB: 2, BB: 1 }, ntc_count: 1, unknown_count: 0, mean_quality: 90.8 },
    ],
    concordance: { concordant_wells: 7, total_compared: 8, percentage: 87.5 },
  };
  expect(projectCsv(summary, 'Unavailable')).toContain('Concordance: 7/8 (87.5%)');
});
const NAMED_PLATE = { session_id: 'a', raw_filename: 'run-a.eds', instrument: 'StepOnePlus', num_wells: 8, genotypes: { AA: 4, AB: 2, BB: 1 }, ntc_count: 1, unknown_count: 0, mean_quality: 91.2 };
const NAMED_SUMMARY = (allele_labels?: { fam: string; allele2: string }): NamedProjectSummary => ({
  project_id: 'p', project_name: 'n', plates: [{ ...NAMED_PLATE, allele_labels }],
  concordance: { concordant_wells: 0, total_compared: 0, percentage: null },
});
it('keeps the canonical header and adds display columns only for named plates', () => {
  const plain = projectCsv(NAMED_SUMMARY(), 'n/a').split('\n');
  expect(plain[0]).toBe('Session ID,Filename,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality');
  const named = projectCsv(NAMED_SUMMARY({ fam: 'WT', allele2: 'MT' }), 'n/a').split('\n');
  expect(named[0]).toBe('Session ID,Filename,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality,AA Name,AB Name,BB Name');
  expect(named[1]).toBe('a,run-a.eds,StepOnePlus,8,4,2,1,1,0,91.2,WT/WT,WT/MT,MT/MT');
  expect(named[2].split(',').length).toBe(named[0].split(',').length);
});
it('neutralizes formulas in allele-name display cells', () => {
  const csv = projectCsv(NAMED_SUMMARY({ fam: '=A', allele2: '@B' }), 'n/a');
  expect(csv).toContain("'=A/=A,'=A/@B,'@B/@B");
});
it('quotes commas, quotes and newlines and bounds the file stem', () => {
  expect(projectCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(projectDownloadName('../../a/b\n')).toBe('a_b_summary.csv');
  expect(projectDownloadName('')).toBe('project_summary.csv');
  expect(projectDownloadName('a'.repeat(200)).length).toBe(112);
});

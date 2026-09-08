import { expect, it } from 'vitest';
import { projectCsv, projectCsvCell, projectDownloadName } from './project-export';
import type { ProjectSummaryResponse } from '@/types/api';
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
it('quotes commas, quotes and newlines and bounds the file stem', () => {
  expect(projectCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  expect(projectDownloadName('../../a/b\n')).toBe('a_b_summary.csv');
  expect(projectDownloadName('')).toBe('project_summary.csv');
  expect(projectDownloadName('a'.repeat(200)).length).toBe(112);
});

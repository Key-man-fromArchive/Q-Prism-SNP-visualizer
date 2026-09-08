import type { ProjectSummaryResponse } from '@/types/api';
import { projectGenotypeCounts } from './project-summary';

export function projectCsvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function projectDownloadName(name: string): string {
  const stem = name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 100).replace(/^_+|_+$/g, '');
  return `${stem || 'project'}_summary.csv`;
}
export function projectCsv(summary: ProjectSummaryResponse, unavailable: string): string {
  const rows = ['Session ID,Filename,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality'];
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const plate of summary.plates) {
    const counts = projectGenotypeCounts(plate);
    const values = [plate.num_wells, counts.AA, counts.AB, counts.BB, counts.NTC, counts.Unknown, plate.mean_quality];
    values.forEach((value, index) => { totals[index] += value; });
    rows.push([plate.session_id, plate.raw_filename, plate.instrument, ...values.slice(0, 6), plate.mean_quality.toFixed(1)].map(projectCsvCell).join(','));
  }
  const mean = summary.plates.length ? totals[6] / summary.plates.length : 0;
  rows.push(['TOTAL', '', '', ...totals.slice(0, 6), mean.toFixed(1)].join(','));
  const c = summary.concordance;
  const percentage = c.percentage === null ? unavailable : `${c.percentage.toFixed(1)}%`;
  rows.push('', `Concordance: ${c.concordant_wells}/${c.total_compared} (${percentage})`);
  return rows.join('\n');
}

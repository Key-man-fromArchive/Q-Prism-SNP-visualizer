import { projectGenotypeCounts, projectGenotypeNames, type NamedProjectSummary } from './project-summary';

export function projectCsvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function projectDownloadName(name: string): string {
  const stem = name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 100).replace(/^_+|_+$/g, '');
  return `${stem || 'project'}_summary.csv`;
}
/** The AA/AB/BB count columns stay canonical; named plates add display-name columns at the end. */
export function projectCsv(summary: NamedProjectSummary, unavailable: string): string {
  const named = summary.plates.some((plate) => plate.allele_labels);
  const names = (labels: NamedProjectSummary['plates'][number]['allele_labels']) =>
    named ? (projectGenotypeNames(labels) ?? ['', '', '']) : [];
  const rows = [`Session ID,Filename,Instrument,Wells,AA,AB,BB,NTC,Unknown,Mean Quality${named ? ',AA Name,AB Name,BB Name' : ''}`];
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const plate of summary.plates) {
    const counts = projectGenotypeCounts(plate);
    const values = [plate.num_wells, counts.AA, counts.AB, counts.BB, counts.NTC, counts.Unknown, plate.mean_quality];
    values.forEach((value, index) => { totals[index] += value; });
    rows.push([plate.session_id, plate.raw_filename, plate.instrument, ...values.slice(0, 6), plate.mean_quality.toFixed(1), ...names(plate.allele_labels)].map(projectCsvCell).join(','));
  }
  const mean = summary.plates.length ? totals[6] / summary.plates.length : 0;
  rows.push(['TOTAL', '', '', ...totals.slice(0, 6), mean.toFixed(1), ...names(null)].join(','));
  const c = summary.concordance;
  const percentage = c.percentage === null ? unavailable : `${c.percentage.toFixed(1)}%`;
  rows.push('', `Concordance: ${c.concordant_wells}/${c.total_compared} (${percentage})`);
  return rows.join('\n');
}

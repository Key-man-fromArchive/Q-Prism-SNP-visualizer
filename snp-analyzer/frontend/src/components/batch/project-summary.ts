import { GENOTYPE_NAME_SEPARATOR } from '@/lib/genotype';
import type { ProjectAlleleLabels, ProjectSummaryResponse } from '@/types/api';

/** Kept as an alias: plates now carry their marker names in the summary itself. */
export type NamedProjectSummary = ProjectSummaryResponse;

type NamedPlate = Pick<ProjectSummaryResponse['plates'][number], 'allele_labels' | 'markers'>;

/** Display names for the AA/AB/BB count columns, FAM-side allele first.
 *  Null unless both allele names exist (the same rule as the marker detail view). */
export function projectGenotypeNames(names: ProjectAlleleLabels | null | undefined) {
  if (!names?.fam || !names.allele2) return null;
  const { fam, allele2 } = names;
  const s = GENOTYPE_NAME_SEPARATOR;
  return [`${fam}${s}${fam}`, `${fam}${s}${allele2}`, `${allele2}${s}${allele2}`];
}

/** The names a plate row can show: its own, else the one set every marker shares. */
export function plateAlleleLabels(plate: NamedPlate): ProjectAlleleLabels | null {
  if (projectGenotypeNames(plate.allele_labels)) return plate.allele_labels ?? null;
  const markers = plate.markers ?? [];
  const first = markers[0]?.allele_labels;
  if (!first || !projectGenotypeNames(first)) return null;
  const same = markers.every((m) => m.allele_labels?.fam === first.fam && m.allele_labels?.allele2 === first.allele2);
  return same ? first : null;
}

type PlateCounts = Pick<ProjectSummaryResponse['plates'][number], 'genotypes' | 'ntc_count' | 'unknown_count'>;

/** One view of the server counts, shared by the table, totals, and CSV. */
export function projectGenotypeCounts(plate: PlateCounts) {
  return {
    AA: plate.genotypes.AA || 0,
    AB: plate.genotypes.AB || 0,
    BB: plate.genotypes.BB || 0,
    NTC: plate.ntc_count || 0,
    Unknown: plate.unknown_count || 0,
  };
}

import { GENOTYPE_NAME_SEPARATOR } from '@/lib/genotype';
import type { AlleleLabels, ProjectSummaryResponse } from '@/types/api';

/** A summary whose plates may carry their marker's allele names (not yet sent by the API). */
export type NamedProjectSummary = Omit<ProjectSummaryResponse, 'plates'> & {
  plates: Array<ProjectSummaryResponse['plates'][number] & { allele_labels?: AlleleLabels | null }>;
};

/** Display names for the AA/AB/BB count columns, FAM-side allele first. */
export function projectGenotypeNames(names: AlleleLabels | null | undefined) {
  if (!names) return null;
  const { fam, allele2 } = names;
  const s = GENOTYPE_NAME_SEPARATOR;
  return [`${fam}${s}${fam}`, `${fam}${s}${allele2}`, `${allele2}${s}${allele2}`];
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

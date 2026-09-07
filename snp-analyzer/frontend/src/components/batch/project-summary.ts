import type { ProjectSummaryResponse } from '@/types/api';

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

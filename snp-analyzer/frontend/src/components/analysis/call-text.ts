import { markerCallLabel } from '@/lib/chart-semantics';
import { displayGenotype } from '@/lib/genotype';
import type { Translations } from '@/locales/en';
import type { AlleleLabels, MarkerRegion } from '@/types/api';

type Appearance = { label: string; description: string };

/** Cell label and long description for a call, using the marker's allele names
 *  when it has them and `appearance` (the unnamed text) otherwise. */
export function callTexts(
  key: string | null,
  t: Readonly<Translations>,
  appearance: Appearance,
  alleleLabels?: AlleleLabels | null,
): Appearance {
  if (key === null || !alleleLabels) return appearance;
  // displayGenotype only reads the allele names
  const named = displayGenotype(key, { allele_labels: alleleLabels } as MarkerRegion);
  if (named === key) return appearance;
  return { label: named, description: markerCallLabel(key, t, { allele_labels: alleleLabels }) };
}

import { genotypeLabels } from "@/lib/genotype";

export type CallCount = { label: string; count: number };

const EXCLUDED_TYPES = new Set(["NTC", "Positive Control", "Empty", "Omit"]);

/** Tallies the calls of a whole-plate run: one cell per genotype class, wells
 *  with no usable call as "Undetermined", controls and omitted wells apart. */
export function countCalls(
  assignments: Record<string, string> | null | undefined, wells: string[], ploidy: number,
): { entries: CallCount[]; excluded: number } {
  const classes = genotypeLabels(ploidy).reverse();
  const counts = new Map<string, number>([...classes, "Undetermined"].map((label) => [label, 0]));
  let excluded = 0;
  for (const well of wells) {
    const call = assignments?.[well];
    if (call && EXCLUDED_TYPES.has(call)) excluded += 1;
    else {
      const label = call && counts.has(call) ? call : "Undetermined";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return { entries: [...counts].map(([label, count]) => ({ label, count })), excluded };
}

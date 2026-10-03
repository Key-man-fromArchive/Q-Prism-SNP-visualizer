export type MarkerChipState = "called" | "none" | "pending";

/** How many leading chips fit in `avail` px, leaving room for the More button when some are left out. */
export function fitChipCount(widths: number[], avail: number, moreWidth: number, gap: number): number {
  if (widths.length === 0) return 0;
  const all = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  if (all <= avail) return widths.length;
  let used = 0;
  let count = 1;
  for (let k = 1; k < widths.length; k++) {
    used += widths[k - 1];
    if (used + gap * (k - 1) + gap + moreWidth > avail) break;
    count = k;
  }
  return count;
}

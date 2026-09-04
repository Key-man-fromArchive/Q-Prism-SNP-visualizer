/**
 * Frontend mirror of backend `app/processing/genotype_vocab.py`.
 *
 * Canonical genotype = integer allele *dosage* 0..P (number of allele-1 / FAM
 * copies); higher dosage => higher fam-fraction. Diploid (P=2) preserves the
 * legacy WellType label strings ("Allele 1 Homo" / "Heterozygous" /
 * "Allele 2 Homo"); higher ploidy uses allele-count strings ("AAAB").
 *
 * Keep the label + palette rules in sync with the backend vocabulary.
 */
import { WELL_TYPE_INFO, UNASSIGNED_TYPE } from './constants';

export const MIN_PLOIDY = 2;
export const MAX_PLOIDY = 8;
export const DEFAULT_PLOIDY = 2;

// dosage 0,1,2 -> legacy diploid strings (verbatim, so P=2 never regresses)
const DIPLOID_LABELS = ['Allele 2 Homo', 'Heterozygous', 'Allele 1 Homo'];

/** Ordered dosage-class labels; index === dosage (0..ploidy). Length ploidy+1. */
export function genotypeLabels(ploidy: number): string[] {
  if (ploidy === 2) return [...DIPLOID_LABELS];
  const out: string[] = [];
  for (let d = 0; d <= ploidy; d++) out.push('A'.repeat(d) + 'B'.repeat(ploidy - d));
  return out;
}

export function genotypeLabel(dosage: number, ploidy: number): string {
  return genotypeLabels(ploidy)[dosage];
}

export function dosageOfLabel(label: string, ploidy: number): number | null {
  const i = genotypeLabels(ploidy).indexOf(label);
  return i < 0 ? null : i;
}

export function isGenotypeLabel(label: string, ploidy: number): boolean {
  return dosageOfLabel(label, ploidy) !== null;
}

/** Compact label for tables/plate cells. Diploid: A1/Het/A2; higher: allele string. */
export function genotypeShortLabel(label: string, ploidy: number): string {
  if (ploidy === 2) {
    if (label === 'Allele 1 Homo') return 'A1';
    if (label === 'Allele 2 Homo') return 'A2';
    if (label === 'Heterozygous') return 'Het';
  }
  return label;
}

// ---------------------------------------------------------------------------
// Dosage palette
// ---------------------------------------------------------------------------
//
// A polyploid locus resolves into P+1 ordered dosage classes, and for P > 2 most
// of them are heterozygous: a hexaploid has five (dosages 1..5) between its two
// homozygotes. They all have to be told apart on the scatter.
//
// This replaces a linear-RGB interpolation red -> green -> blue. Interpolating
// between complementary hues in RGB passes through desaturated mud, and it was
// the MIDDLE of the scale -- every heterozygous class -- that paid for it. The
// hexaploid ramp came out #dc2626, #985744 (brown), #548863 (drab olive),
// #10b981, #179ca4 (teal), #1e80c8, #2563eb, with adjacent classes only
// dE 30.3 apart (OKLab x100) and 11.9 under deuteranopia. At P=8 it was 20.8
// and 9.0 -- adjacent dosages genuinely indistinguishable, because the ramp
// interpolated along the red-green axis, the worst possible one for CVD.
//
// Instead: two arms stepped in OKLCH with monotone lightness and matched
// chroma, red for the allele-2 pole and blue for the allele-1 pole. Every arm
// passes the ordinal gate (monotone L, adjacent dL >= 0.06, light end >= 2:1 on
// its surface, single hue) in BOTH modes.
//
// Colour cannot do this alone, and it is important not to pretend otherwise:
// on a scatter any two marks can sit side by side, and no seven-colour palette
// clears the pairwise-distinctness floors (the best candidate measured dE 4.0
// deutan / 14.7 normal-vision against a floor of 15). So dosage also carries a
// SHAPE, which is what actually separates neighbouring classes; the ramp's job
// is to show the ORDER and which allele dominates.
//
// Two deliberate deviations from the general diverging rule:
//
//   * P = 2 keeps the legacy trio verbatim (#dc2626 / #10b981 / #2563eb, all
//     circles), like genotypeLabels does for its label strings. Diploid plates
//     are the common case and must not change appearance.
//   * the balanced class of an even ploidy (dosage P/2) stays GREEN rather than
//     becoming the neutral grey a diverging midpoint normally takes. The rule
//     exists for scales whose midpoint means "nothing"; here it is a real, and
//     often the most interesting, genotype -- and grey is already spoken for by
//     Undetermined (#6b7280) and Unknown (#9ca3af), so a grey class would read
//     as a no-call.
//
// Arms run pole -> inner end. The light end of each is capped short of the
// surface so every mark stays visible; the dark mode steps are its own
// selection against the dark surface, not a flip of the light ones (the light
// ramp's deep blue #0d366b measures 1.41:1 on #1a1d27 -- invisible).
const RED_ARM_LIGHT = ['#76221d', '#892c26', '#9e342e', '#b14038', '#c74940', '#d7584e', '#dd7166', '#e4857b'];
const BLUE_ARM_LIGHT = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec'];
const RED_ARM_DARK = ['#b14038', '#c74940', '#d7584e', '#dd7166', '#e4857b', '#ea9a91', '#f0aca4'];
const BLUE_ARM_DARK = ['#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];
const BALANCED_LIGHT = '#10b981';
const BALANCED_DARK = '#34d399';
const DIPLOID_COLORS_LIGHT = ['#dc2626', BALANCED_LIGHT, '#2563eb'];
const DIPLOID_COLORS_DARK = ['#dc2626', BALANCED_DARK, '#2563eb'];

// Indexed by dosage. Adjacent dosages never share a shape, which is what makes
// neighbouring classes separable when their colours are one ramp step apart.
//
// Circle is deliberately NOT first: NTC is a fixed black circle and it sits at
// the origin, right where the dosage-0 wells (all allele-2, so also low on the
// FAM axis) collect -- the two would have differed by colour alone in exactly
// the region where they overlap. It goes to the balanced class instead, which
// sits out in the middle of the plot with nothing to be confused with.
//
// The x-marked types (Undetermined, Empty, Omit) use a shape no dosage class
// takes; Positive Control is a diamond, but amber and never near the ramp.
const DOSAGE_SYMBOLS = [
  'square',
  'diamond',
  'triangle-up',
  'circle',
  'hexagon',
  'star',
  'triangle-down',
  'pentagon',
  'bowtie',
];

/** Read the live theme. Mirrors plotly-theme's isDarkMode so this module keeps
 *  no import cycle with it; callers that need to RE-RENDER on a theme change
 *  should subscribe with useIsDarkMode and pass `dark` explicitly. */
function currentlyDark(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('dark');
}

/** `n` steps from an arm, pole first, evenly spaced across it. */
function armSteps(arm: string[], n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [arm[0]];
  return Array.from({ length: n }, (_, i) => arm[Math.round((i * (arm.length - 1)) / (n - 1))]);
}

/** Colours for every dosage 0..ploidy, in dosage order. */
export function dosagePalette(ploidy: number, dark = currentlyDark()): string[] {
  if (ploidy === 2) return dark ? [...DIPLOID_COLORS_DARK] : [...DIPLOID_COLORS_LIGHT];
  const even = ploidy % 2 === 0;
  // An odd ploidy has no balanced class, so the two arms simply meet.
  const perArm = even ? ploidy / 2 : (ploidy + 1) / 2;
  const low = armSteps(dark ? RED_ARM_DARK : RED_ARM_LIGHT, perArm);
  const high = armSteps(dark ? BLUE_ARM_DARK : BLUE_ARM_LIGHT, perArm).reverse();
  const balanced = dark ? BALANCED_DARK : BALANCED_LIGHT;
  return even ? [...low, balanced, ...high] : [...low, ...high];
}

export function genotypeColor(dosage: number, ploidy: number, dark = currentlyDark()): string {
  const palette = dosagePalette(ploidy, dark);
  return palette[Math.max(0, Math.min(dosage, palette.length - 1))];
}

/** Marker shape for a dosage. Diploid keeps circles everywhere it always had
 *  them; above that, shape is what carries identity when two classes are one
 *  ramp step apart. */
export function genotypeSymbol(dosage: number, ploidy: number): string {
  if (ploidy === 2) return 'circle';
  return DOSAGE_SYMBOLS[dosage % DOSAGE_SYMBOLS.length];
}

/** Descending fam-fraction midpoints (d+0.5)/P — equal-spacing first approximation. */
export function defaultRatioCuts(ploidy: number): number[] {
  const cuts: number[] = [];
  for (let d = ploidy - 1; d >= 0; d--) cuts.push((d + 0.5) / ploidy);
  return cuts;
}

/** Dosage for fam-fraction r given descending cuts. ``offset`` places the observed
 * window of classes within the 0..P ladder (dosage = offset + zone index). */
export function dosageByRatio(r: number, ploidy: number, cuts?: number[], offset = 0): number {
  const c = cuts ?? defaultRatioCuts(ploidy);
  return offset + c.reduce((n, cut) => (r >= cut ? n + 1 : n), 0);
}

/** Genotype label for fam-fraction r given descending cuts + window offset. */
export function labelByRatio(r: number, ploidy: number, cuts?: number[], offset = 0): string {
  return genotypeLabel(dosageByRatio(r, ploidy, cuts, offset), ploidy);
}

export type GenotypeClass = {
  key: string; // the assignment string stored on the well
  label: string;
  short: string;
  color: string;
  symbol: string;
  dosage: number;
};

/** Ordered genotype classes, highest dosage first (allele-1 dominant on top). */
export function genotypeClasses(ploidy: number, dark?: boolean): GenotypeClass[] {
  const palette = dosagePalette(ploidy, dark);
  return genotypeLabels(ploidy)
    .map((label, d) => ({
      key: label,
      label,
      short: genotypeShortLabel(label, ploidy),
      color: palette[d],
      symbol: genotypeSymbol(d, ploidy),
      dosage: d,
    }))
    .reverse();
}

type WellInfo = { label: string; color: string; symbol: string };

/** Resolve display info for ANY assignment string: dosage genotype (ploidy-aware),
 * a fixed control/non-genotype type, or the unassigned fallback.
 *
 * `dark` defaults to the live theme. A component that must REPAINT when the
 * theme changes has to subscribe (useIsDarkMode) and pass the value, or React
 * has no reason to re-run this. */
export function wellInfo(
  key: string | null | undefined,
  ploidy: number,
  dark?: boolean
): WellInfo {
  if (key) {
    const d = dosageOfLabel(key, ploidy);
    if (d !== null) {
      return {
        label: key,
        color: genotypeColor(d, ploidy, dark),
        symbol: genotypeSymbol(d, ploidy),
      };
    }
    const fixed = (WELL_TYPE_INFO as Record<string, WellInfo>)[key];
    if (fixed) return fixed;
  }
  return UNASSIGNED_TYPE;
}

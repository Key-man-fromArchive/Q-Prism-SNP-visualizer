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

// Diverging ordered palette anchored on the legacy diploid colors:
// dosage 0 (all allele-2) = red, middle = green, top (all allele-1) = blue.
// At P=2 this reproduces A2=#dc2626 / Het=#10b981 / A1=#2563eb exactly.
const A2_RGB = [0xdc, 0x26, 0x26];
const HET_RGB = [0x10, 0xb9, 0x81];
const A1_RGB = [0x25, 0x63, 0xeb];

function lerp(a: number[], b: number[], t: number): string {
  const c = a.map((av, i) => Math.round(av + (b[i] - av) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function genotypeColor(dosage: number, ploidy: number): string {
  const f = ploidy <= 0 ? 0 : dosage / ploidy; // 0 (allele2) .. 1 (allele1)
  if (f <= 0.5) return lerp(A2_RGB, HET_RGB, f / 0.5);
  return lerp(HET_RGB, A1_RGB, (f - 0.5) / 0.5);
}

/** Descending fam-fraction midpoints (d+0.5)/P — equal-spacing first approximation. */
export function defaultRatioCuts(ploidy: number): number[] {
  const cuts: number[] = [];
  for (let d = ploidy - 1; d >= 0; d--) cuts.push((d + 0.5) / ploidy);
  return cuts;
}

/** Dosage (0..P) for fam-fraction r given descending boundary cuts. */
export function dosageByRatio(r: number, ploidy: number, cuts?: number[]): number {
  const c = cuts ?? defaultRatioCuts(ploidy);
  return c.reduce((n, cut) => (r >= cut ? n + 1 : n), 0);
}

/** Genotype label for fam-fraction r given descending boundary cuts. */
export function labelByRatio(r: number, ploidy: number, cuts?: number[]): string {
  return genotypeLabel(dosageByRatio(r, ploidy, cuts), ploidy);
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
export function genotypeClasses(ploidy: number): GenotypeClass[] {
  return genotypeLabels(ploidy)
    .map((label, d) => ({
      key: label,
      label,
      short: genotypeShortLabel(label, ploidy),
      color: genotypeColor(d, ploidy),
      symbol: 'circle',
      dosage: d,
    }))
    .reverse();
}

type WellInfo = { label: string; color: string; symbol: string };

/** Resolve display info for ANY assignment string: dosage genotype (ploidy-aware),
 * a fixed control/non-genotype type, or the unassigned fallback. */
export function wellInfo(key: string | null | undefined, ploidy: number): WellInfo {
  if (key) {
    const d = dosageOfLabel(key, ploidy);
    if (d !== null) {
      return { label: key, color: genotypeColor(d, ploidy), symbol: 'circle' };
    }
    const fixed = (WELL_TYPE_INFO as Record<string, WellInfo>)[key];
    if (fixed) return fixed;
  }
  return UNASSIGNED_TYPE;
}

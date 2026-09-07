import { wellInfo } from './genotype';
import type { Translations } from '@/locales/en';

const LABEL_KEYS: Record<string, keyof Translations> = {
  NTC: 'wellTypeNTC', Unknown: 'wellTypeUnknown', 'Positive Control': 'wellTypePositiveControl',
  'Allele 1 Homo': 'wellTypeAllele1Homo', 'Allele 2 Homo': 'wellTypeAllele2Homo',
  Heterozygous: 'wellTypeHeterozygous', Undetermined: 'wellTypeUndetermined',
  Empty: 'wellTypeEmpty', Omit: 'wellTypeOmit', Unassigned: 'wellTypeUnassigned',
};

export function callLabel(key: string, t: Readonly<Translations>): string {
  const value = t[LABEL_KEYS[key]];
  return typeof value === 'string' ? value : key;
}

/** Presentation only: canonical keys, dosage, colors and assignments are untouched. */
const SYMBOLS: Record<string, string> = {
  'Allele 1 Homo': 'triangle-up', Heterozygous: 'circle', 'Allele 2 Homo': 'square',
  NTC: 'cross', 'Positive Control': 'diamond', Unknown: 'circle-open',
  Undetermined: 'x', Empty: 'square-open', Omit: 'x-open', Unassigned: 'diamond-open',
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** sRGB alpha composition of the actual rendered fill and surface. */
export function compositeColor(fill: string, surface: string, opacity: number): string {
  return '#' + [1, 3, 5].map(offset => Math.round(
    parseInt(fill.slice(offset, offset + 2), 16) * opacity + parseInt(surface.slice(offset, offset + 2), 16) * (1 - opacity)
  ).toString(16).padStart(2, '0')).join('');
}

function accessibleFill(fill: string, dark: boolean): string {
  const surface = dark ? '#1a1d27' : '#ffffff';
  const pole = dark ? '#ffffff' : '#000000';
  for (let step = 0; step <= 10; step++) {
    const candidate = compositeColor(pole, fill, step / 10);
    if (contrastRatio(candidate, surface) >= 3.1) return candidate;
  }
  return pole;
}

const SHORT_CALLS: Record<string, string> = { 'Allele 1 Homo': 'Hom-1', 'Allele 2 Homo': 'Hom-2', Heterozygous: 'Het' };
const GLYPHS: Record<string, string> = { 'triangle-up': '▲', circle: '●', square: '■', cross: '+', diamond: '◆', 'circle-open': '○', x: '×', 'square-open': '□', 'x-open': '⊗', 'diamond-open': '◇', hexagon: '⬢', star: '★', 'triangle-down': '▼', pentagon: '⬟', bowtie: '⋈' };

export function callAppearance(key: string | null, ploidy: number, dark: boolean, t: Readonly<Translations>) {
  if (key === null) return { label: '', description: t.chartNoDisplayedCall, bgColor: 'transparent', textColor: dark ? '#f4f4f5' : '#18181b', symbol: 'circle-open', glyph: '', stroke: 'transparent' };
  const info = chartCategory(key, ploidy, dark);
  const cellColor = wellInfo(key, ploidy, dark).color;
  return {
    label: SHORT_CALLS[key] ?? callLabel(key, t),
    description: callLabel(key, t),
    bgColor: cellColor,
    textColor: contrastRatio('#ffffff', cellColor) > contrastRatio('#000000', cellColor) ? '#ffffff' : '#000000',
    symbol: info.symbol,
    glyph: GLYPHS[info.symbol] ?? '·',
    stroke: info.stroke,
  };
}

export function displayedCall(point: Readonly<{ manual_type: string | null; auto_cluster: string | null }> | undefined, manual: boolean, automatic: boolean): string | null {
  if (!point) return null;
  if (manual && point.manual_type) return point.manual_type;
  return automatic ? point.auto_cluster : null;
}

export function outsideDisplayScope(well: string, scope: readonly string[] | undefined): boolean {
  return scope !== undefined && !scope.includes(well);
}

export function chartCategory(key: string, ploidy: number, dark: boolean) {
  const info = wellInfo(key, ploidy, dark);
  const foreground = dark ? '#f4f4f5' : '#18181b';
  return { ...info, color: accessibleFill(info.color, dark), opacity: 1, symbol: SYMBOLS[key] ?? info.symbol, stroke: foreground, text: foreground };
}

export function chartPointState(selected: boolean, flagged: boolean, dark: boolean) {
  return {
    width: selected ? 3 : flagged ? 2.5 : 1.5,
    stroke: dark ? '#f4f4f5' : '#18181b',
    textKey: selected ? 'selected' : flagged ? 'flagged' : 'ordinary',
  } as const;
}

export function chartStateText(selected: boolean, flagged: boolean, t: Readonly<Translations>): string {
  return [selected ? t.wellSelectedState : '', flagged ? t.chartReferenceFlagged : ''].filter(Boolean).join(' · ');
}

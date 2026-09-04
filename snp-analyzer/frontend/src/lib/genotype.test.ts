import { describe, expect, it } from 'vitest';
import {
  dosagePalette,
  genotypeClasses,
  genotypeColor,
  genotypeLabels,
  genotypeSymbol,
  wellInfo,
} from './genotype';
import { WELL_TYPE_INFO, UNASSIGNED_TYPE } from './constants';

const PLOIDIES = [2, 3, 4, 5, 6, 7, 8];

// The desaturated midtones the old linear-RGB red->green->blue interpolation
// produced for a hexaploid: brown, drab olive and teal, where dosages 1, 2 and 4
// landed. They are here so the mud cannot come back -- interpolating between
// complementary hues in RGB desaturates the MIDDLE of the scale, which on a
// polyploid marker is every heterozygous class. (The old ramp's own red and
// blue ends were fine and are deliberately not listed: the new ramp is allowed
// to sit near them.)
const OLD_HEXAPLOID_MUD = ['#985744', '#548863', '#179ca4'];

/** Euclidean distance in OKLab x100 -- the metric the palette was built against. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const lin = (v: number) => (v /= 255, v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * 100,
      (1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 100,
      (0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s) * 100,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function lightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lin = (v: number) => (v /= 255, v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

describe('dosage palette', () => {
  it('gives every dosage class its own colour', () => {
    for (const ploidy of PLOIDIES) {
      const palette = dosagePalette(ploidy, false);
      expect(palette).toHaveLength(ploidy + 1);
      expect(new Set(palette).size).toBe(ploidy + 1);
    }
  });

  it('keeps the diploid trio verbatim in both modes', () => {
    // Diploid plates are the common case; their appearance must not change.
    expect(dosagePalette(2, false)).toEqual(['#dc2626', '#10b981', '#2563eb']);
    expect(genotypeSymbol(0, 2)).toBe('circle');
    expect(genotypeSymbol(1, 2)).toBe('circle');
    expect(genotypeSymbol(2, 2)).toBe('circle');
    // Dark only lifts the midpoint for the dark surface; the poles are the same.
    const dark = dosagePalette(2, true);
    expect([dark[0], dark[2]]).toEqual(['#dc2626', '#2563eb']);
  });

  it('runs from the allele-2 pole to the allele-1 pole', () => {
    for (const ploidy of PLOIDIES) {
      const palette = dosagePalette(ploidy, false);
      // Dosage 0 is all allele-2 (red family), dosage P all allele-1 (blue).
      expect(deltaE(palette[0], '#dc2626')).toBeLessThan(deltaE(palette[0], '#2563eb'));
      expect(deltaE(palette[ploidy], '#2563eb')).toBeLessThan(deltaE(palette[ploidy], '#dc2626'));
    }
  });

  it('steps monotonically in lightness within each arm', () => {
    // What makes the ramp readable AS a ramp: each arm gets lighter toward the
    // middle, so the reader sees the dosage order in the colour.
    for (const ploidy of [4, 6, 8]) {
      const palette = dosagePalette(ploidy, false);
      const half = ploidy / 2;
      for (let d = 0; d < half - 1; d++) {
        expect(lightness(palette[d + 1])).toBeGreaterThan(lightness(palette[d]));
      }
      for (let d = half + 1; d < ploidy; d++) {
        expect(lightness(palette[d + 1])).toBeLessThan(lightness(palette[d]));
      }
    }
  });

  it('never reproduces the muddy interpolated midtones', () => {
    for (const ploidy of PLOIDIES) {
      for (const mud of OLD_HEXAPLOID_MUD) {
        for (const color of dosagePalette(ploidy, false)) {
          expect(deltaE(color, mud)).toBeGreaterThan(5);
        }
      }
    }
  });

  it('marks the balanced class of an even ploidy in green, not grey', () => {
    // Grey is already Undetermined/Unknown, so a grey class would read as a
    // no-call rather than as the genotype it is.
    for (const ploidy of [4, 6, 8]) {
      expect(dosagePalette(ploidy, false)[ploidy / 2]).toBe('#10b981');
    }
    // An odd ploidy has no balanced class, so no green appears at all.
    for (const ploidy of [3, 5, 7]) {
      expect(dosagePalette(ploidy, false)).not.toContain('#10b981');
    }
  });

  it('selects its own steps for dark rather than reusing the light ones', () => {
    // The light ramp's deep blue measures 1.41:1 on the dark surface -- invisible.
    for (const ploidy of [3, 4, 6, 8]) {
      const light = dosagePalette(ploidy, false);
      const dark = dosagePalette(ploidy, true);
      expect(dark).not.toEqual(light);
      // Every dark step is lighter than the light-mode step it replaces.
      dark.forEach((c, d) => {
        if (c !== light[d]) expect(lightness(c)).toBeGreaterThan(lightness(light[d]));
      });
    }
  });
});

describe('dosage symbols', () => {
  it('never repeats a shape between adjacent dosages', () => {
    // Colour alone cannot separate 7-9 marks on a scatter, so shape is what
    // distinguishes neighbouring classes when their colours are one step apart.
    for (const ploidy of PLOIDIES.filter((p) => p > 2)) {
      for (let d = 0; d < ploidy; d++) {
        expect(genotypeSymbol(d, ploidy)).not.toBe(genotypeSymbol(d + 1, ploidy));
      }
    }
  });

  it('gives every class of the largest ploidy a distinct shape', () => {
    const shapes = Array.from({ length: 9 }, (_, d) => genotypeSymbol(d, 8));
    expect(new Set(shapes).size).toBe(9);
  });

  it('does not give dosage 0 the circle that NTC already owns', () => {
    // Both sit low on the FAM axis, so where they overlap they would otherwise
    // differ by colour alone.
    for (const ploidy of PLOIDIES.filter((p) => p > 2)) {
      expect(genotypeSymbol(0, ploidy)).not.toBe(WELL_TYPE_INFO.NTC.symbol);
    }
  });

  it('does not hand a dosage class the x reserved for no-calls', () => {
    const reserved = new Set<string>(
      Object.values(WELL_TYPE_INFO)
        .filter((info) => info.symbol === 'x')
        .map((info) => info.symbol)
    );
    for (const ploidy of PLOIDIES) {
      for (let d = 0; d <= ploidy; d++) {
        expect(reserved.has(genotypeSymbol(d, ploidy))).toBe(false);
      }
    }
  });
});

describe('wellInfo', () => {
  it('resolves a dosage label to its ramp colour and shape', () => {
    const info = wellInfo('AAABBB', 6, false);
    expect(info.color).toBe(dosagePalette(6, false)[3]);
    expect(info.symbol).toBe(genotypeSymbol(3, 6));
  });

  it('still honours the fixed control types', () => {
    expect(wellInfo('NTC', 6, false)).toEqual(WELL_TYPE_INFO.NTC);
    expect(wellInfo('Undetermined', 6, false)).toEqual(WELL_TYPE_INFO.Undetermined);
  });

  it('falls back for anything it does not recognise', () => {
    expect(wellInfo('not a genotype', 6, false)).toEqual(UNASSIGNED_TYPE);
    expect(wellInfo(null, 6, false)).toEqual(UNASSIGNED_TYPE);
  });

  it('follows the theme', () => {
    expect(wellInfo('AAABBB', 6, true).color).not.toBe(wellInfo('AAABBB', 6, false).color);
  });
});

describe('genotypeClasses', () => {
  it('lists highest dosage first, each with its own colour and shape', () => {
    const classes = genotypeClasses(6, false);
    expect(classes.map((c) => c.key)).toEqual([...genotypeLabels(6)].reverse());
    expect(classes[0].dosage).toBe(6);
    expect(new Set(classes.map((c) => c.color)).size).toBe(7);
    expect(new Set(classes.map((c) => c.symbol)).size).toBe(7);
    // Consistent with the single-label resolver the plots use alongside it.
    for (const c of classes) {
      expect(c.color).toBe(genotypeColor(c.dosage, 6, false));
    }
  });
});

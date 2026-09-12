import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P6-S2-T1: brand palette (Deep Teal) replaces the Tailwind-default blue that
// `--color-primary` was borrowing, and that blue happened to collide with
// `--color-fam` (identical value) -- buttons and FAM data points read as the
// same color. This test locks the new tokens in both the `@theme` (light)
// and `body.dark` blocks, and locks the two things that must NOT move:
// the qPCR channel colors (--color-fam / --color-allele2, D-4) and the
// warning/danger/success state hues.

const css = readFileSync(resolve(__dirname, './index.css'), 'utf-8');

function block(name: 'theme' | 'dark'): string {
  const re = name === 'theme' ? /@theme\s*\{([\s\S]*?)\n\}/ : /body\.dark\s*\{([\s\S]*?)\n\}/;
  const m = css.match(re);
  if (!m) throw new Error(`could not find ${name} block in index.css`);
  return m[1];
}

function token(src: string, name: string): string {
  const m = src.match(new RegExp(`${name.replace(/[-]/g, '\\-')}:\\s*([^;]+);`));
  if (!m) throw new Error(`token ${name} not found`);
  return m[1].trim();
}

describe('index.css brand palette (P6-S2-T1)', () => {
  const theme = block('theme');
  const dark = block('dark');

  it('applies the Deep Teal primary in light mode', () => {
    expect(token(theme, '--color-primary')).toBe('#0f766e');
    expect(token(theme, '--color-primary-hover')).toBe('#115e59');
  });

  it('applies the brightened Deep Teal primary in dark mode', () => {
    expect(token(dark, '--color-primary')).toBe('#2dd4bf');
    expect(token(dark, '--color-primary-hover')).toBe('#14b8a6');
  });

  it('defines an on-primary text color that is dark-on-mint in dark mode', () => {
    // #2dd4bf is a light mint; white text on it fails WCAG AA, so dark mode
    // needs a dark foreground for text sitting on a --color-primary surface.
    expect(token(theme, '--color-on-primary')).toBe('#ffffff');
    expect(token(dark, '--color-on-primary')).toBe('#0e1413');
  });

  it('applies the violet accent in both modes', () => {
    expect(token(theme, '--color-accent')).toBe('#7c3aed');
    expect(token(dark, '--color-accent')).toBe('#a78bfa');
  });

  it('applies the new neutral surface/text scale in light mode', () => {
    expect(token(theme, '--color-bg')).toBe('#f5f8f8');
    expect(token(theme, '--color-border')).toBe('#dde5e4');
    expect(token(theme, '--color-text')).toBe('#16211f');
    expect(token(theme, '--color-text-muted')).toBe('#5f6f6c');
  });

  it('applies the new neutral surface/text scale in dark mode', () => {
    expect(token(dark, '--color-bg')).toBe('#0e1413');
    expect(token(dark, '--color-surface')).toBe('#17201f');
    expect(token(dark, '--color-border')).toBe('#2a3a38');
    expect(token(dark, '--color-text')).toBe('#e3ecea');
    expect(token(dark, '--color-text-muted')).toBe('#93a5a2');
  });

  it('never moves --color-fam / --color-allele2 (D-4: qPCR channel convention)', () => {
    expect(token(theme, '--color-fam')).toBe('#2563eb');
    expect(token(theme, '--color-allele2')).toBe('#dc2626');
    expect(token(dark, '--color-fam')).toBe('#60a5fa');
    expect(token(dark, '--color-allele2')).toBe('#f87171');
  });

  it('preserves warning/danger/success state color meaning in both modes', () => {
    expect(token(theme, '--color-warning')).toBe('#f59e0b');
    expect(token(theme, '--color-danger')).toBe('#ef4444');
    expect(token(theme, '--color-success')).toBe('#10b981');
    expect(token(dark, '--color-warning')).toBe('#fbbf24');
    expect(token(dark, '--color-danger')).toBe('#ef4444');
    expect(token(dark, '--color-success')).toBe('#34d399');
  });

  it('routes native range-input thumbs/tracks through --color-primary', () => {
    // The cycle slider (CycleControl.tsx) is a plain <input type="range">
    // with no explicit color styling, so it rendered with the browser's
    // default (blue) accent color regardless of the palette. Every re-skin
    // of --color-primary must carry it along.
    expect(css).toMatch(/input\[type=["']range["']\]\s*\{[^}]*accent-color:\s*var\(--color-primary\)/);
  });
});

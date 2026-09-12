import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// P6-S2-T1: in dark mode, --color-primary is now a light mint (#2dd4bf).
// Any element combining `bg-primary` with a literal `text-white` renders
// unreadable (contrast ~1.7:1) in dark mode, whereas the app's actual
// design system provides a theme-aware `text-on-primary` for exactly this
// purpose (see index.css.test.ts). This scans every component for the
// stale combination so a future PR can't reintroduce it one button at a
// time the way this one was found (CycleControl's window selector).
const SRC = resolve(__dirname, '..');

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name.endsWith('.test.tsx') || entry.name.endsWith('.test.ts')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// A same-element check, not a same-file check: `bg-primary` and
// `text-white` inside one JSX class expression are always close together
// (same string literal, or split across a two-/three-line template literal
// ternary like the avatar badge in UserManagement.tsx), so a 200-character
// proximity window catches both shapes without needing a real JSX parser.
const PAIR = /bg-primary[\s\S]{0,200}?text-white|text-white[\s\S]{0,200}?bg-primary/g;

describe('no component pairs bg-primary with a hardcoded text-white', () => {
  it('scans every .ts/.tsx source file for the stale combination', () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC)) {
      const content = readFileSync(file, 'utf-8');
      if (PAIR.test(content)) offenders.push(file);
      PAIR.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});

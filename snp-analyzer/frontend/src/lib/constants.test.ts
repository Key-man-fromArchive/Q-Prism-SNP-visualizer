import { describe, expect, it } from 'vitest';
import {
  BRAND_HEX,
  COLORS,
  WELL_TYPE_INFO,
  UNASSIGNED_TYPE,
  MARKER_PALETTE,
  PROTOCOL_PHASE_COLORS,
  PROTOCOL_AMP_COLORS,
  PROTOCOL_PHASE_FALLBACK,
} from './constants';

// P0-T0.2 characterization test: constants.ts's colors move to reference
// chart-colors.ts's BRAND_HEX instead of repeating hex literals, but no
// value may change. This locks every exported color to its pre-refactor
// hex so that consolidation can't silently drift a value.

describe('constants color values (P0-T0.2 value lock)', () => {
  it('keeps WELL_TYPE_INFO colors unchanged', () => {
    expect(WELL_TYPE_INFO.NTC.color).toBe('#000000');
    expect(WELL_TYPE_INFO.Unknown.color).toBe('#9ca3af');
    expect(WELL_TYPE_INFO['Positive Control'].color).toBe('#f59e0b');
    expect(WELL_TYPE_INFO['Allele 1 Homo'].color).toBe('#2563eb');
    expect(WELL_TYPE_INFO['Allele 2 Homo'].color).toBe('#dc2626');
    expect(WELL_TYPE_INFO.Heterozygous.color).toBe('#10b981');
    expect(WELL_TYPE_INFO.Undetermined.color).toBe('#6b7280');
    expect(WELL_TYPE_INFO.Empty.color).toBe('#374151');
    expect(WELL_TYPE_INFO.Omit.color).toBe('#a16207');
  });

  it('keeps UNASSIGNED_TYPE color unchanged', () => {
    expect(UNASSIGNED_TYPE.color).toBe('#6366f1');
  });

  it('keeps COLORS unchanged', () => {
    expect(COLORS).toEqual({
      fam: '#2563eb',
      allele2: '#dc2626',
      rox: '#f59e0b',
      bg: '#f5f7fa',
      surface: '#ffffff',
      border: '#e0e4e8',
      text: '#1a1a2e',
      textMuted: '#6b7280',
      primary: '#2563eb',
      accent: '#10b981',
      danger: '#ef4444',
    });
  });

  it('keeps MARKER_PALETTE unchanged', () => {
    expect(MARKER_PALETTE).toEqual([
      '#7c5cd6', '#d98a1e', '#2f9e5a', '#d5504e',
      '#3f86c4', '#12a3ad', '#b7519f', '#7a8794',
    ]);
  });
});

// This module is the single source genotype.ts and ProtocolTab.tsx now
// import from. Lock its values so a future edit here can't silently
// change what either consumer renders.
describe('BRAND_HEX (P0-T0.2 value lock)', () => {
  it('matches the pre-refactor literals it replaced', () => {
    expect(BRAND_HEX).toEqual({
      blue600: '#2563eb',
      blue500: '#3b82f6',
      red600: '#dc2626',
      red500: '#ef4444',
      amber500: '#f59e0b',
      green500: '#10b981',
      green400: '#34d399',
      gray500: '#6b7280',
    });
  });
});

describe('ProtocolTab phase color maps (P0-T0.2 value lock)', () => {
  it('matches the pre-refactor PHASE_COLORS literal', () => {
    expect(PROTOCOL_PHASE_COLORS).toEqual({
      'Pre-read': { border: '#3b82f6', label: '#2563eb' },
      'Initial Denaturation': { border: '#ef4444', label: '#dc2626' },
      'Post-read': { border: '#10b981', label: '#059669' },
    });
  });

  it('matches the pre-refactor AMP_COLORS literal', () => {
    expect(PROTOCOL_AMP_COLORS).toEqual([
      { border: '#f59e0b', label: '#d97706' },
      { border: '#f97316', label: '#ea580c' },
      { border: '#ea580c', label: '#c2410c' },
      { border: '#dc2626', label: '#b91c1c' },
    ]);
  });

  it('matches the pre-refactor fallback literal', () => {
    expect(PROTOCOL_PHASE_FALLBACK).toEqual({ border: '#94a3b8', label: '#64748b' });
  });
});

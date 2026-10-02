import { describe, expect, it } from 'vitest';
import { NO_AMPLIFICATION, markNoAmplification, noAmplificationSet, qcConfigFromSettings, qcSummaryParts } from './amplification-qc';
import type { AmplificationQcResult } from '@/types/api';

const qc: AmplificationQcResult = {
  enabled: true, available: true, fraction: 1 / 3, fam_threshold: 1.2, allele2_threshold: 0.1,
  source: 'auto', baseline_cycle: 0, read_cycle: 2, no_amplification_wells: ['A1', 'B2'],
};

describe('noAmplificationSet', () => {
  it('lists the flagged wells only when the check ran', () => {
    expect([...noAmplificationSet(qc)]).toEqual(['A1', 'B2']);
    expect(noAmplificationSet({ ...qc, enabled: false, source: 'off' }).size).toBe(0);
    expect(noAmplificationSet({ ...qc, available: false }).size).toBe(0);
    expect(noAmplificationSet(null).size).toBe(0);
  });
});

describe('markNoAmplification', () => {
  const well = (id: string, auto: string | null, manual: string | null = null) =>
    ({ well: id, auto_cluster: auto, manual_type: manual });
  it('relabels only undetermined/uncalled flagged wells and keeps real calls', () => {
    const wells = [well('A1', 'Undetermined'), well('B2', null), well('C3', 'Undetermined')];
    const out = markNoAmplification(wells, new Set(['A1', 'B2']));
    expect(out.map((w) => w.auto_cluster)).toEqual([NO_AMPLIFICATION, NO_AMPLIFICATION, 'Undetermined']);
    const heteroFlagged = markNoAmplification([well('A1', 'Heterozygous')], new Set(['A1']));
    expect(heteroFlagged[0].auto_cluster).toBe('Heterozygous');
    expect(wells[0].auto_cluster).toBe('Undetermined');
  });
  it('returns the same array when nothing is flagged', () => {
    const wells = [well('A1', 'Undetermined')];
    expect(markNoAmplification(wells, new Set())).toBe(wells);
  });
});

describe('qcConfigFromSettings', () => {
  const base = { enabled: true, fraction: 1 / 3, famThreshold: null, allele2Threshold: null };
  it('is absent at the defaults so unchanged requests stay unchanged', () => {
    expect(qcConfigFromSettings(base)).toBeUndefined();
  });
  it('sends every non-default choice', () => {
    expect(qcConfigFromSettings({ ...base, enabled: false }))
      .toEqual({ enabled: false, fraction: 1 / 3, fam_threshold: null, allele2_threshold: null });
    expect(qcConfigFromSettings({ ...base, fraction: 0.5, famThreshold: 2 }))
      .toEqual({ enabled: true, fraction: 0.5, fam_threshold: 2, allele2_threshold: null });
  });
});

describe('qcSummaryParts', () => {
  it('names the real channels and the applied values', () => {
    expect(qcSummaryParts(qc, { fam: 'FAM', allele2: 'VIC' })).toEqual({
      channels: [{ label: 'FAM', value: '1.20' }, { label: 'VIC', value: '0.10' }], source: 'auto',
    });
  });
  it('is null when there is nothing to show', () => {
    expect(qcSummaryParts(null, { fam: 'FAM', allele2: 'VIC' })).toBeNull();
    expect(qcSummaryParts({ ...qc, available: false }, { fam: 'FAM', allele2: 'VIC' })).toBeNull();
  });
});

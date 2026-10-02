import { describe, expect, it } from 'vitest';
import { validUploadResponse } from './upload-response';

const base = {
  session_id: 's', instrument: 'StepOnePlus', allele2_dye: 'VIC', num_wells: 96, num_cycles: 3, has_rox: true,
  suggested_cycle: 2, well_groups: null, data_windows: null,
};

describe('validUploadResponse StepOne fields', () => {
  it('accepts responses without or with well-formed optional fields', () => {
    expect(validUploadResponse(base)).toBe(true);
    expect(validUploadResponse({
      ...base, default_cycle: 2, has_amplification_curve: false,
      read_labels: { 1: { stage: 'pre', pcr_cycle: null, temperature: null }, 2: { stage: 'amp', pcr_cycle: 36, temperature: 40 } },
    })).toBe(true);
    expect(validUploadResponse({ ...base, default_cycle: null, read_labels: null })).toBe(true);
  });

  it('rejects malformed optional fields', () => {
    expect(validUploadResponse({ ...base, default_cycle: -1 })).toBe(false);
    expect(validUploadResponse({ ...base, default_cycle: '2' })).toBe(false);
    expect(validUploadResponse({ ...base, has_amplification_curve: 'no' })).toBe(false);
    expect(validUploadResponse({ ...base, read_labels: [] })).toBe(false);
    expect(validUploadResponse({ ...base, read_labels: { 1: { pcr_cycle: 3 } } })).toBe(false);
    expect(validUploadResponse({ ...base, read_labels: { 1: { stage: 'amp', temperature: 'hot' } } })).toBe(false);
  });
});

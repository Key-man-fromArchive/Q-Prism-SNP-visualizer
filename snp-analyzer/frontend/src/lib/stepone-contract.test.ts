import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { EXPORT_TEST_IDS } from './export-testids';
import { displayGenotype } from './genotype';
import type { AlleleLabels, MarkerRegion, ReadLabel, SessionInfoResponse, UploadResponse } from '@/types/api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('StepOne frontend contract types', () => {
  it('accepts the backend response fields and keeps them optional', () => {
    const labels: AlleleLabels = { fam: 'WT', allele2: 'MT' };
    const read: ReadLabel = { stage: 'Amplification', pcr_cycle: 1, temperature: null };
    const legacy: UploadResponse = {
      session_id: 's', instrument: 'x', allele2_dye: 'VIC', num_wells: 1, num_cycles: 1,
      has_rox: true, data_windows: null, suggested_cycle: null, well_groups: null,
    };
    const current: UploadResponse = {
      ...legacy, default_cycle: 2, read_labels: { 2: read }, has_amplification_curve: false,
    };
    const info: SessionInfoResponse = { ...current, input_revision: 0 } as SessionInfoResponse;
    const marker: MarkerRegion = { id: 'm', name: 'M', wells: [], ploidy: 2, allele_labels: labels };
    const unset: MarkerRegion = { id: 'm', name: 'M', wells: [], ploidy: 2 };
    expect(info.read_labels?.[2].stage).toBe('Amplification');
    expect(marker.allele_labels?.fam).toBe('WT');
    expect(unset.allele_labels).toBeUndefined();
    expect(legacy.default_cycle).toBeUndefined();
  });
});

describe('export request contract', () => {
  it('sends marker_ids only when given, as a comma-separated list', async () => {
    const fetcher = stubFetch();
    await api.exportPdf('s', undefined, undefined, undefined, undefined, ['a', 'b']);
    await api.exportCsv('s', undefined, undefined, undefined, undefined, ['a']);
    await api.exportXlsx('s', undefined, undefined, undefined, undefined, ['a', 'b']);
    await api.exportPdf('s');
    expect(decodeURIComponent(fetcher.mock.calls[0][0])).toContain('/export/pdf?marker_ids=a,b');
    expect(decodeURIComponent(fetcher.mock.calls[1][0])).toContain('/export/csv?marker_ids=a');
    expect(decodeURIComponent(fetcher.mock.calls[2][0])).toContain('/export/xlsx?marker_ids=a,b');
    expect(fetcher.mock.calls[3][0]).not.toContain('marker_ids');
  });

  it('exposes the PPTX and PNG-zip exports', async () => {
    const fetcher = stubFetch();
    await api.exportPptx('s', undefined, undefined, 3, 'rev', ['m1']);
    await api.exportScatterZip('s', undefined, undefined, undefined, undefined, ['m1', 'm2']);
    const [pptx, zip] = fetcher.mock.calls.map((call) => decodeURIComponent(call[0]));
    expect(pptx).toContain('/export/pptx?cycle=3&cycle_mode=absolute');
    expect(pptx).toContain('result_revision=rev');
    expect(pptx).toContain('marker_ids=m1');
    expect(zip).toContain('/export/scatter-png.zip?marker_ids=m1,m2');
  });

  it('lets updateMarker patch and clear allele_labels', async () => {
    const fetcher = stubFetch();
    await api.updateMarker('s', 'm', { allele_labels: { fam: 'WT', allele2: 'MT' } }, 1);
    await api.updateMarker('s', 'm', { allele_labels: null }, 1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).allele_labels).toEqual({ fam: 'WT', allele2: 'MT' });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).allele_labels).toBeNull();
  });
});

describe('contract stubs', () => {
  it('displayGenotype returns the existing label until P1-D', () => {
    expect(displayGenotype('Heterozygous')).toBe('Heterozygous');
    expect(displayGenotype('Allele 1 Homo', { id: 'm', name: 'M', wells: [], ploidy: 2 })).toBe('Allele 1 Homo');
  });

  it('keeps export test ids unique and kebab-case', () => {
    const values = Object.values(EXPORT_TEST_IDS);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^export-[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

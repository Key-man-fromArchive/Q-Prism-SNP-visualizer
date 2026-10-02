import { describe, expect, it } from 'vitest';
import type {
  AmplificationQcConfig, AmplificationQcResult, AnalysisContext, ClusteringRequest,
  ClusteringResult, InstrumentDetail, SessionInfoResponse,
} from '@/types/api';
import { parseClusterResponse } from '@/lib/analysis-context';

describe('P7 contract types', () => {
  it('accepts the request config as optional fields', () => {
    const cfg: AmplificationQcConfig = { fraction: 0.5, fam_threshold: 10, allele2_threshold: null };
    const req: ClusteringRequest = { algorithm: 'threshold', cycle: 1, n_clusters: 4, amplification_qc: cfg };
    expect(JSON.parse(JSON.stringify(req)).amplification_qc.fraction).toBe(0.5);
    const none: ClusteringRequest = { algorithm: 'threshold', cycle: 1, n_clusters: 4 };
    expect(none.amplification_qc).toBeUndefined();
  });

  it('carries the QC result through the cluster response parser', () => {
    const qc: AmplificationQcResult = {
      enabled: true, available: true, fraction: 1 / 3, fam_threshold: 1, allele2_threshold: null,
      source: 'mixed', baseline_cycle: 0, read_cycle: 1, no_amplification_wells: ['A1'],
    };
    const raw = { algorithm: 'threshold', cycle: 1, assignments: { A1: 'Undetermined' }, amplification_qc: qc };
    const parsed = parseClusterResponse(raw) as ClusteringResult;
    expect(parsed.amplification_qc?.no_amplification_wells).toEqual(['A1']);
    const ctx: Pick<AnalysisContext, 'amplification_qc'> = { amplification_qc: qc };
    expect(ctx.amplification_qc?.source).toBe('mixed');
  });

  it('exposes instrument detail as optional on session responses', () => {
    const detail: InstrumentDetail = { vendor: 'Applied Biosystems', model: 'StepOnePlus', software: 'StepOne Software v2.3' };
    const upload: Pick<SessionInfoResponse, 'instrument_detail'> = { instrument_detail: detail };
    expect(upload.instrument_detail?.model).toBe('StepOnePlus');
    const legacy: Pick<SessionInfoResponse, 'instrument_detail'> = {};
    expect(legacy.instrument_detail).toBeUndefined();
  });
});

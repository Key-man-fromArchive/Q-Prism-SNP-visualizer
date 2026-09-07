import { describe, expect, it } from 'vitest';
import { parseQualityTarget, resolveQualityTarget, qualityTargetMatchesView, type QualityTarget } from './quality-target';

const target: QualityTarget = { session: 's', well: 'A1', source: 'ntc', basis: 'current-input',
  cycle: 0, useRox: false, inputRevision: 2, resultRevision: 'result-2', marker: null, background: 'none' };
const domain = { session: 's', wells: ['A1', 'P24'], cycles: [0, 10, 40], inputRevision: 2,
  resultRevision: 'result-2', markers: [] as { id: string; wells: string[] }[] };

describe('quality target admission', () => {
  it('keeps literal zero and routes whole-plate targets without manufacturing a marker', () => {
    expect(resolveQualityTarget(target, domain)).toEqual({ target, surface: 'analysis' });
  });
  it('resolves membership from fresh inventory and routes unassigned input wells to setup', () => {
    const markers = [{ id: 'm', wells: ['P24'] }];
    expect(resolveQualityTarget(target, { ...domain, markers })?.surface).toBe('plate');
    expect(resolveQualityTarget({ ...target, well: 'P24' }, { ...domain, markers })?.target.marker).toBe('m');
  });
  it.each([
    { session: 'other' }, { wells: ['P24'] }, { wells: null }, { cycles: [10, 40] },
    { inputRevision: 3 }, { resultRevision: 'replaced' },
  ])('fails closed for unavailable or changed authority: %j', change => {
    expect(resolveQualityTarget(target, { ...domain, ...change })).toBeNull();
  });
  it('never guesses among overlapping marker memberships or a deleted explicit marker', () => {
    expect(resolveQualityTarget(target, { ...domain, markers: [
      { id: 'a', wells: ['A1'] }, { id: 'b', wells: ['A1'] },
    ] })).toBeNull();
    expect(resolveQualityTarget({ ...target, marker: 'deleted' }, domain)).toBeNull();
  });
  it('keeps curve quality explicitly unversioned rather than pinning genotype revisions', () => {
    const curve: QualityTarget = { session: 's', well: 'A1', source: 'curve', basis: 'unversioned',
      cycle: 0, useRox: true, inputRevision: null, resultRevision: null, marker: null };
    expect(resolveQualityTarget(curve, { ...domain, inputRevision: 9, resultRevision: null })?.target).toEqual(curve);
    expect(qualityTargetMatchesView(curve, { useRox: true, backgroundMode: 'pre_read' })).toBe(true);
    expect(parseQualityTarget({ ...curve, inputRevision: 9 })).toBeNull();
  });
  it('history parsing only copies approved scalar fields and rejects coerced enums', () => {
    expect(parseQualityTarget({ ...target, token: 'private', sample: 'private' })).toEqual(target);
    expect(parseQualityTarget({ ...target, source: ['ntc'] })).toBeNull();
    expect(parseQualityTarget({ ...target, cycle: '0' })).toBeNull();
    expect(parseQualityTarget({ ...target, well: 'not a well' })).toBeNull();
    expect(parseQualityTarget({ ...target, background: 'invented' })).toBeNull();
    expect(parseQualityTarget({ ...target, background: ['none'] })).toBeNull();
    expect(parseQualityTarget(null)).toBeNull();
  });
});

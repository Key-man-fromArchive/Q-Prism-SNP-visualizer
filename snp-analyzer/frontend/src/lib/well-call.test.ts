import { describe, expect, it } from 'vitest';
import { callForWell } from './well-call';

const points = new Map([
  ['A1', { manual_type: 'AA', auto_cluster: 'BB' }],
  ['A2', { manual_type: null, auto_cluster: 'AB' }],
  ['A3', { manual_type: null, auto_cluster: null }],
]);

describe('callForWell', () => {
  it('prefers the manual call when manual calls are shown', () => {
    expect(callForWell('A1', { points, showManualTypes: true, showAutoCluster: true })).toBe('AA');
  });
  it('falls back to the automatic call, and honours the show-automatic gate', () => {
    expect(callForWell('A2', { points, showManualTypes: true, showAutoCluster: true })).toBe('AB');
    expect(callForWell('A2', { points, showManualTypes: true, showAutoCluster: false })).toBeNull();
    expect(callForWell('A1', { points, showManualTypes: false, showAutoCluster: true })).toBe('BB');
  });
  it('returns null for a well with no call or no row', () => {
    expect(callForWell('A3', { points, showManualTypes: true, showAutoCluster: true })).toBeNull();
    expect(callForWell('Z9', { points, showManualTypes: true, showAutoCluster: true })).toBeNull();
  });
  it('reads marker assignments when given, and wells outside the marker have none', () => {
    const assignments = { A1: 'WT/WT' };
    expect(callForWell('A1', { assignments, points, showManualTypes: true, showAutoCluster: true })).toBe('WT/WT');
    expect(callForWell('A2', { assignments, points, showManualTypes: true, showAutoCluster: true })).toBeNull();
    expect(callForWell('A1', { assignments: null })).toBeNull();
  });
});

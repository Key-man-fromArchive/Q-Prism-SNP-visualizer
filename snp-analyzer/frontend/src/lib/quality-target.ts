import type { BackgroundMode } from '@/types/api';
type TargetAddress = {
  session: string; well: string; cycle: number; useRox: boolean; marker: string | null;
};
/** History contains navigation identifiers only, never the measured data or sample labels. */
export type QualityTarget = TargetAddress & (
  | { source: 'ntc'; basis: 'current-input'; inputRevision: number; resultRevision: string | null; background: BackgroundMode }
  | { source: 'curve'; basis: 'unversioned'; inputRevision: null; resultRevision: null }
);
export type QualityTargetDomain = {
  session: string; wells: readonly string[] | null; cycles: readonly number[];
  inputRevision: number; resultRevision: string | null;
  markers: readonly { id: string; wells: readonly string[] }[];
};
export type ResolvedQualityTarget = { target: QualityTarget; surface: 'analysis' | 'plate' };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}
function background(value: unknown): value is BackgroundMode { return value === 'none' || value === 'pre_read' || value === 'channel_min'; }
export function qualityTargetMatchesView(target: QualityTarget, view: { useRox: boolean; backgroundMode: BackgroundMode }) {
  if (target.useRox !== view.useRox) return false;
  return target.source === 'curve' || target.background === view.backgroundMode;
}
function readAddress(value: Record<string, unknown>): TargetAddress | null {
  if (typeof value.session !== 'string' || !value.session) return null;
  if (typeof value.well !== 'string' || !/^[A-P](?:[1-9]|1\d|2[0-4])$/.test(value.well)) return null;
  if (!nonnegative(value.cycle) || typeof value.useRox !== 'boolean' || !nullableString(value.marker)) return null;
  return { session: value.session, well: value.well, cycle: value.cycle, useRox: value.useRox, marker: value.marker };
}
export function parseQualityTarget(value: unknown): QualityTarget | null {
  if (!record(value)) return null;
  const address = readAddress(value);
  if (!address) return null;
  if (value.source === 'curve') return readCurve(value, address);
  if (value.source !== 'ntc' || value.basis !== 'current-input') return null;
  if (!nonnegative(value.inputRevision) || !nullableString(value.resultRevision) || !background(value.background)) return null;
  return { ...address, source: 'ntc', basis: 'current-input', inputRevision: value.inputRevision,
    resultRevision: value.resultRevision, background: value.background };
}
function readCurve(value: Record<string, unknown>, address: TargetAddress): QualityTarget | null {
  if (value.basis !== 'unversioned' || value.inputRevision !== null || value.resultRevision !== null) return null;
  return { ...address, source: 'curve', basis: 'unversioned', inputRevision: null, resultRevision: null };
}
function currentAuthority(target: QualityTarget, domain: QualityTargetDomain): boolean {
  if (target.session !== domain.session || !domain.wells?.includes(target.well)) return false;
  if (!domain.cycles.includes(target.cycle)) return false;
  if (target.source === 'curve') return true;
  return target.inputRevision === domain.inputRevision && target.resultRevision === domain.resultRevision;
}
/** No signal-based inference: zero and cycle-missing input wells remain inventory members. */
export function resolveQualityTarget(target: QualityTarget, domain: QualityTargetDomain): ResolvedQualityTarget | null {
  if (!currentAuthority(target, domain)) return null;
  const markers = domain.markers.filter(marker => marker.wells.length > 0);
  const memberships = markers.filter(marker => marker.wells.includes(target.well));
  const marker = selectedMembership(target, memberships);
  if (marker === undefined) return null;
  return { target: { ...target, marker }, surface: markers.length > 0 && marker === null ? 'plate' : 'analysis' };
}
function selectedMembership(target: QualityTarget, memberships: QualityTargetDomain['markers']): string | null | undefined {
  if (target.marker !== null && !memberships.some(marker => marker.id === target.marker)) return undefined;
  if (target.marker === null && memberships.length > 1) return undefined;
  return target.marker ?? memberships[0]?.id ?? null;
}

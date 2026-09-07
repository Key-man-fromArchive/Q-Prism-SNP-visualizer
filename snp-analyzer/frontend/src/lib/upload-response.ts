import type { UploadResponse } from '@/types/api';

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
function groups(value: unknown): boolean {
  return value === null || (record(value) && Object.values(value).every(group => Array.isArray(group) && group.every(well => typeof well === 'string')));
}
function windows(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.every(window => record(window)
    && typeof window.name === 'string' && nonnegative(window.start_cycle) && nonnegative(window.end_cycle) && window.end_cycle >= window.start_cycle));
}
function basics(value: Record<string, unknown>): boolean {
  return ['session_id', 'instrument', 'allele2_dye'].every(key => typeof value[key] === 'string' && value[key].length > 0)
    && nonnegative(value.num_wells) && nonnegative(value.num_cycles) && typeof value.has_rox === 'boolean';
}
/** A partial 200 response is not enough to admit a session or claim upload success. */
export function validUploadResponse(value: unknown): value is UploadResponse {
  if (!record(value) || !basics(value)) return false;
  if (value.suggested_cycle !== null && !nonnegative(value.suggested_cycle)) return false;
  if (value.background_modes !== undefined && (!Array.isArray(value.background_modes)
    || !value.background_modes.every(mode => ['none', 'pre_read', 'channel_min'].includes(mode)))) return false;
  return groups(value.well_groups) && windows(value.data_windows);
}

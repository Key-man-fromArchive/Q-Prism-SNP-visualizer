import type { PresetResponse, SessionListItem } from '@/types/api';
export function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonnegative(value: unknown): boolean { return typeof value === 'number' && Number.isInteger(value) && value >= 0; }
export function validPreset(value: unknown): value is PresetResponse {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.builtin === 'boolean' && isRecord(value.settings);
}
export function validRecentSession(value: unknown): value is SessionListItem {
  if (!isRecord(value)) return false;
  return typeof value.session_id === 'string' && value.session_id.length > 0 && typeof value.instrument === 'string'
    && nonnegative(value.num_wells) && nonnegative(value.num_cycles) && typeof value.uploaded_at === 'string'
    && (value.raw_filename === undefined || typeof value.raw_filename === 'string');
}

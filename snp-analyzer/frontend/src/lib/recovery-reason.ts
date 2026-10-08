import { ApiError } from './api';
import { UnreadableFileError } from './read-upload-file';
import type { RecoveryReason } from '@/stores/upload-job-store';

/** Fixed public reason codes; server bodies/URLs never become recovery copy. */
export function recoveryReason(error: unknown): RecoveryReason {
  if (error instanceof UnreadableFileError) return 'unreadable';
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === 'eds_no_measurement_data') return 'no_measurement_data';
  const reasons: Record<number, RecoveryReason> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found' };
  return reasons[error.status] ?? (error.status >= 500 ? 'server' : 'invalid');
}

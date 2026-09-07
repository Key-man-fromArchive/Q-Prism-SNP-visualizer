import { ApiError } from './api';
import type { RecoveryReason } from '@/stores/upload-job-store';

/** Fixed public reason codes; server bodies/URLs never become recovery copy. */
export function recoveryReason(error: unknown): RecoveryReason {
  if (!(error instanceof ApiError)) return 'network';
  const reasons: Record<number, RecoveryReason> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found' };
  return reasons[error.status] ?? (error.status >= 500 ? 'server' : 'invalid');
}

import { ApiError, uploadFile } from './api';
import { recoveryReason } from './recovery-reason';
import { validUploadResponse } from './upload-response';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useUploadJobStore, type UploadTicket } from '@/stores/upload-job-store';
import type { UploadResponse } from '@/types/api';

// Shared batch limits: the file workspace drawer and the central drop zone are
// two separate implementations (by design, see FB-02 D-7 — not unified), but
// they must reject the same oversized drop with the same numbers and the same
// message. Both read these constants instead of keeping their own copies.
export const MAX_FILES_PER_DROP = 20;
export const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const MAX_TOTAL_MB = MAX_TOTAL_BYTES / (1024 * 1024);

export type UploadLimitViolation = 'too_many_files' | 'total_too_large';

/** Neither caller pre-filters for supported extensions the same way, so this
 *  only judges the count/size of whatever file list it is given — each
 *  caller narrows to its own "supported" subset first. */
export function uploadLimitViolation(files: readonly File[]): UploadLimitViolation | null {
  if (files.length > MAX_FILES_PER_DROP) return 'too_many_files';
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return 'total_too_large';
  return null;
}

function current(ticket: UploadTicket): boolean {
  return useAuthStore.getState().user?.id === ticket.ownerId && useUploadJobStore.getState().current(ticket);
}
function isFormatError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400
    && typeof error.detail === 'string' && error.detail.startsWith('Failed to parse file:');
}
async function uploadOne(ticket: UploadTicket, file: File, index: number, onFormatError?: () => void): Promise<UploadResponse | null> {
  const store = useUploadJobStore.getState();
  store.update(ticket, index, { stage: 'uploading' });
  try {
    const response = await uploadFile(file);
    if (!current(ticket)) return null;
    if (!validUploadResponse(response)) {
      store.update(ticket, index, { stage: 'unknown', reason: 'response_lost' });
      return null;
    }
    store.update(ticket, index, { stage: 'success', sessionId: response.session_id });
    // Every uploaded plate joins the workspace, whether or not it is the one
    // being activated — that is what makes a batch upload reachable later
    // instead of only the last file surviving.
    useSessionStore.getState().addOpenSession(response.session_id);
    return response;
  } catch (error) {
    if (!current(ticket)) return null;
    if (isFormatError(error)) onFormatError?.();
    const reason = recoveryReason(error);
    store.update(ticket, index, reason === 'network'
      ? { stage: 'unknown', reason: 'response_lost' } : { stage: 'failed', reason });
    return null;
  }
}
/** File references live only for this request loop, never in retained job state. */
export async function runUploadJobs(files: readonly File[], onFormatError?: () => void): Promise<UploadResponse | null> {
  const owner = useAuthStore.getState().user?.id;
  if (!owner) return null;
  const store = useUploadJobStore.getState();
  const ticket = store.begin(owner, files.map(file => file.name));
  if (!ticket) return null;
  let single: UploadResponse | null = null;
  try {
    for (const [index, file] of files.entries()) {
      if (!current(ticket)) return null;
      const result = await uploadOne(ticket, file, index, files.length === 1 ? onFormatError : undefined);
      if (files.length === 1) single = result;
    }
    return current(ticket) ? single : null;
  } finally { store.finish(ticket); }
}

import { ApiError, uploadFile } from './api';
import { recoveryReason } from './recovery-reason';
import { validUploadResponse } from './upload-response';
import { useAuthStore } from '@/stores/auth-store';
import { useUploadJobStore, type UploadTicket } from '@/stores/upload-job-store';
import type { UploadResponse } from '@/types/api';

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

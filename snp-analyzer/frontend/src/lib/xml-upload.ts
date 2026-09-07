import JSZip from 'jszip';
import { uploadFile } from './api';
import { recoveryReason } from './recovery-reason';
import { validUploadResponse } from './upload-response';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useUploadJobStore, type UploadStage, type RecoveryReason } from '@/stores/upload-job-store';
import type { UploadResponse } from '@/types/api';

function failureReason(dispatched: boolean, error: unknown): RecoveryReason {
  return dispatched ? recoveryReason(error) : 'invalid';
}

async function packageXml(files: readonly File[], current: () => boolean): Promise<File | null> {
  const zip = new JSZip();
  for (const file of files) {
    const data = await file.arrayBuffer();
    if (!current()) return null;
    zip.file(file.name, data);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return current() ? new File([blob], 'cfx_xml_export.zip', { type: 'application/zip' }) : null;
}
/** All source filenames share the known outcome of their single generated archive. */
export async function runXmlUpload(files: readonly File[]): Promise<UploadResponse | null> {
  const owner = useAuthStore.getState().user?.id;
  if (!owner) return null;
  const store = useUploadJobStore.getState();
  const ticket = store.begin(owner, files.map(file => file.name));
  if (!ticket) return null;
  const entry = useSessionStore.getState().entryGeneration;
  const current = () => useAuthStore.getState().user?.id === owner
    && useSessionStore.getState().entryGeneration === entry && store.current(ticket);
  const update = (stage: UploadStage, reason?: RecoveryReason, sessionId?: string) =>
    files.forEach((_, index) => store.update(ticket, index, { stage, reason, sessionId }));
  let dispatched = false;
  update('packaging');
  try {
    const file = await packageXml(files, current);
    if (!file) return null;
    dispatched = true;
    update('uploading');
    const response = await uploadFile(file);
    if (!current()) return null;
    if (!validUploadResponse(response)) { update('unknown', 'response_lost'); return null; }
    update('success', undefined, response.session_id);
    return response;
  } catch (error) {
    if (!current()) return null;
    const reason = failureReason(dispatched, error);
    if (reason === 'network') update('unknown', 'response_lost');
    else update('failed', reason);
    return null;
  } finally { store.finish(ticket); }
}

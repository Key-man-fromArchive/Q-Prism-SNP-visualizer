import type { MarkerRegion, SessionInfoResponse } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';

export type QualityMetadata = {
  owner: string; auth: number; entry: number; session: string;
  markers: MarkerRegion[]; info: SessionInfoResponse;
};
const listeners = new Set<(value: QualityMetadata) => void>();
export function subscribeQualityMetadata(listener: (value: QualityMetadata) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishQualityMetadata(value: QualityMetadata) {
  const auth = useAuthStore.getState();
  const session = useSessionStore.getState();
  if (value.owner !== auth.user?.id || value.auth !== auth.generation) return;
  if (value.session !== session.sessionId || value.entry !== session.entryGeneration) return;
  for (const listener of listeners) listener(structuredClone(value));
}

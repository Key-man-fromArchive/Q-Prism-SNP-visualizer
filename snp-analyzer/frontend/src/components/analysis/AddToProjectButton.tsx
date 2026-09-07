import { useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { getProjects, addProjectSession } from '@/lib/api';
import { useI18n } from '@/hooks/use-i18n';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { Button, Modal } from '@/components/shared/ui';

type ProjectItem = { id: string; name: string; session_count: number };

function ProjectPicker({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const owned = useOwnedOperation();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { owned.begin(); setOpen(false); setBusy(false); };
  const load = async () => {
    const ticket = owned.begin();
    setOpen(true); setBusy(true); setMessage(null); setError(null);
    try {
      const data = await getProjects();
      if (owned.current(ticket)) setProjects(data.projects);
    } catch {
      if (owned.current(ticket)) setError(t.failedToLoadProjects);
    } finally { if (owned.current(ticket)) setBusy(false); }
  };
  const add = async (project: ProjectItem) => {
    if (busy) return;
    const ticket = owned.begin();
    setBusy(true); setMessage(null); setError(null);
    try {
      await addProjectSession(project.id, sessionId);
      if (!owned.current(ticket)) return;
      setMessage(t.addedTo(project.name));
      try {
        const data = await getProjects();
        if (owned.current(ticket)) setProjects(data.projects);
      } catch {
        if (owned.current(ticket)) setError(t.failedToLoadProjects);
      }
    } catch {
      if (owned.current(ticket)) setError(t.projectActionFailed);
    } finally { if (owned.current(ticket)) setBusy(false); }
  };
  return <>
    <button type="button" onClick={() => void load()} className="badge cursor-pointer hover:text-primary hover:border-primary transition-colors text-xs" title={t.addThisToProject}>
      {t.plusProject}
    </button>
    <Modal open={open} onClose={close} title={t.addToProject}
      footer={<><Button variant="secondary" disabled={busy} onClick={() => void load()}>{t.retry}</Button><Button variant="secondary" onClick={close}>{t.cancel}</Button></>}>
      {busy && <p role="status">{t.loading}</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!busy && projects.length === 0 && <p>{t.noProjectsCreate}</p>}
      <div className="flex flex-col gap-1">
        {projects.map(project => <Button key={project.id} variant="secondary" disabled={busy} onClick={() => void add(project)} className="justify-between whitespace-normal text-left">
          <span className="min-w-0 wrap-anywhere">{project.name}</span><span className="shrink-0">{project.session_count}</span>
        </Button>)}
      </div>
    </Modal>
  </>;
}

export function AddToProjectButton() {
  const sessionId = useSessionStore(state => state.sessionId);
  const entry = useSessionStore(state => state.entryGeneration);
  const owner = useAuthStore(state => state.user?.id);
  return sessionId ? <ProjectPicker key={`${owner}:${sessionId}:${entry}`} sessionId={sessionId} /> : null;
}

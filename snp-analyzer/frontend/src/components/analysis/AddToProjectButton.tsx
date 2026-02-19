import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { getProjects, addProjectSession } from '@/lib/api';

type ProjectItem = { id: string; name: string; session_count: number };

export function AddToProjectButton() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = async () => {
    if (open) { setOpen(false); return; }
    try {
      const data = await getProjects();
      setProjects(data.projects);
      setStatus(null);
      setOpen(true);
    } catch {
      setStatus('Failed to load projects');
    }
  };

  const handleAdd = async (projectId: string, projectName: string) => {
    if (!sessionId) return;
    try {
      await addProjectSession(projectId, sessionId);
      setStatus(`Added to "${projectName}"`);
      // Refresh project list to update counts
      const data = await getProjects();
      setProjects(data.projects);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setStatus(msg);
    }
  };

  if (!sessionId) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="badge cursor-pointer hover:text-primary hover:border-primary transition-all text-xs"
        title="Add this session to a project"
      >
        + Project
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-surface border border-border rounded shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border text-xs text-text-muted font-medium">
            Add to project
          </div>
          {projects.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-muted">
              No projects. Create one in the Project tab.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p.id, p.name)}
                  className="w-full text-left px-3 py-2 text-sm text-text hover:bg-bg transition-colors flex justify-between items-center"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-text-muted ml-2">{p.session_count}</span>
                </button>
              ))}
            </div>
          )}
          {status && (
            <div className={`px-3 py-2 border-t border-border text-xs ${
              status.startsWith('Added') ? 'text-green-600' : 'text-red-600'
            }`}>
              {status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

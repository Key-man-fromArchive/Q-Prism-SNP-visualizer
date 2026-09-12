import { useEffect, useEffectEvent, useState } from 'react';
import type { UserListItem, AdminDashboardUser } from '@/types/auth';
import { getUsers, createUser, updateUser, deleteUser, getAdminDashboard } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useI18n } from '@/hooks/use-i18n';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { useConfirm } from '@/hooks/use-confirm';
import { navigateTabs } from '@/lib/tab-keyboard';
import { useSessionStore } from '@/stores/session-store';
import { validDashboardUser, validManagementList, validUser } from '@/lib/management-payload';

type SubTab = 'dashboard' | 'users';

export function UserManagement() {
  const { t } = useI18n();
  const user = useAuthStore(s => s.user), generation = useAuthStore(s => s.generation);
  const entry = useSessionStore(s => s.entryGeneration);
  if (user?.role !== 'admin') return <div role="alert" className="p-4 text-danger">{t.recoveryForbidden}</div>;
  return <AdminWorkspace key={`${generation}:${user.id}:${entry}`} />;
}

function AdminWorkspace() {
  const { t } = useI18n();
  const listOwner = useOwnedOperation(), dashboardOwner = useOwnedOperation(), actionOwner = useOwnedOperation(), confirmationOwner = useOwnedOperation();
  const { confirm, confirmDialog } = useConfirm();
  const [subTab, setSubTab] = useState<SubTab>('dashboard');
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  // Dashboard state
  const [dashboardUsers, setDashboardUsers] = useState<AdminDashboardUser[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState<AdminDashboardUser | null>(null);

  const loadUsers = async () => {
    const ticket = listOwner.begin();
    setError('');
    try {
      const res = await getUsers();
      if (!listOwner.current(ticket)) return;
      if (!validManagementList(res, 'users', validUser)) throw new Error('Invalid users response');
      setUsers(res.users);
    } catch {
      if (listOwner.current(ticket)) setError(t.statusLoadFailed);
    } finally {
      if (listOwner.current(ticket)) setLoading(false);
    }
  };

  const loadDashboard = async () => {
    const ticket = dashboardOwner.begin();
    setDashboardLoading(true);
    try {
      const res = await getAdminDashboard();
      if (!dashboardOwner.current(ticket)) return;
      if (!validManagementList(res, 'users', validDashboardUser)) throw new Error('Invalid dashboard response');
      setDashboardUsers(res.users);
    } catch {
      if (dashboardOwner.current(ticket)) setError(t.statusLoadFailed);
    } finally {
      if (dashboardOwner.current(ticket)) setDashboardLoading(false);
    }
  };

  const initialLoad = useEffectEvent(() => { void loadUsers(); void loadDashboard(); });
  useEffect(() => { initialLoad(); }, []);

  const handleDelete = async (userId: string, username: string) => {
    const confirmationTicket = confirmationOwner.begin();
    if (!(await confirm({ title: t.delete, message: t.deleteUserConfirm(username), danger: true }))) return;
    if (!confirmationOwner.current(confirmationTicket)) return;
    const ticket = actionOwner.begin();
    if (!actionOwner.current(ticket)) return;
    try {
      await deleteUser(userId);
      if (!actionOwner.current(ticket)) return;
      await Promise.all([loadUsers(), loadDashboard()]);
    } catch {
      if (actionOwner.current(ticket)) setError(t.libraryActionFailed);
    }
  };

  const handleToggleActive = async (user: UserListItem) => {
    const ticket = actionOwner.begin();
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      if (!actionOwner.current(ticket)) return;
      await loadUsers();
    } catch {
      if (actionOwner.current(ticket)) setError(t.libraryActionFailed);
    }
  };

  const handleToggleRole = async (user: UserListItem) => {
    const ticket = actionOwner.begin();
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUser(user.id, { role: newRole });
      if (!actionOwner.current(ticket)) return;
      await loadUsers();
    } catch {
      if (actionOwner.current(ticket)) setError(t.libraryActionFailed);
    }
  };

  if (loading) return <div role="status" className="p-6 text-text-muted">{t.loadingUsers}</div>;

  // Summary stats for dashboard
  const totalSessions = dashboardUsers.reduce((a, u) => a + u.session_count, 0);
  const totalProjects = dashboardUsers.reduce((a, u) => a + u.project_count, 0);
  const totalDataPoints = dashboardUsers.reduce((a, u) => a + u.total_data_points, 0);

  return (
    <div className="p-4 sm:p-6 min-w-0">
      {confirmDialog}
      {error && <div role="alert" className="text-danger mb-3">{error} <button type="button" onClick={() => { void loadUsers(); void loadDashboard(); }}>{t.retry}</button></div>}
      {/* Sub-tab nav */}
      <div role="tablist" aria-label={t.userManagement} onKeyDown={navigateTabs} className="flex flex-wrap gap-0 mb-4 border-b border-border">
        <button
          role="tab" aria-selected={subTab === 'dashboard'} aria-controls="admin-dashboard-panel" id="admin-dashboard-tab" tabIndex={subTab === 'dashboard' ? 0 : -1}
          onClick={() => { setSubTab('dashboard'); setSelectedMember(null); }}
          className={`px-4 py-2 text-sm border-b-2 transition-colors ${
            subTab === 'dashboard'
              ? 'text-primary border-b-primary font-medium'
              : 'text-text-muted border-b-transparent hover:text-text'
          }`}
        >
          {t.adminDashboard}
        </button>
        <button
          role="tab" aria-selected={subTab === 'users'} aria-controls="admin-users-panel" id="admin-users-tab" tabIndex={subTab === 'users' ? 0 : -1}
          onClick={() => setSubTab('users')}
          className={`px-4 py-2 text-sm border-b-2 transition-colors ${
            subTab === 'users'
              ? 'text-primary border-b-primary font-medium'
              : 'text-text-muted border-b-transparent hover:text-text'
          }`}
        >
          {t.userManagement}
        </button>
      </div>

      {/* ═══ Dashboard Tab ═══ */}
      <div id="admin-dashboard-panel" role="tabpanel" aria-labelledby="admin-dashboard-tab" hidden={subTab !== 'dashboard'}>
      {subTab === 'dashboard' && !selectedMember && (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="panel text-center">
              <div className="text-2xl font-bold text-text">{dashboardUsers.length}</div>
              <div className="text-xs text-text-muted">{t.totalMembers}</div>
            </div>
            <div className="panel text-center">
              <div className="text-2xl font-bold text-primary">{totalSessions}</div>
              <div className="text-xs text-text-muted">{t.totalSessions}</div>
            </div>
            <div className="panel text-center">
              <div className="text-2xl font-bold text-accent">{totalProjects}</div>
              <div className="text-xs text-text-muted">{t.totalProjects}</div>
            </div>
            <div className="panel text-center">
              <div className="text-2xl font-bold text-text">{formatNumber(totalDataPoints)}</div>
              <div className="text-xs text-text-muted">{t.totalDataPoints}</div>
            </div>
          </div>

          {/* Member cards */}
          {dashboardLoading ? (
            <div className="text-text-muted text-sm">{t.loading}</div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text">{t.memberOverview}</h3>
              {dashboardUsers.length === 0 && <p className="text-sm text-text-muted text-center py-6">{t.noMembers}</p>}
              {dashboardUsers.map((u) => {
                const lastSession = u.sessions[0];
                return (
                  <button type="button"
                    key={u.id}
                    className="panel w-full text-left flex flex-wrap items-center gap-4 cursor-pointer hover:border-primary transition-colors"
                    onClick={() => setSelectedMember(u)}
                  >
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-on-primary text-sm font-bold shrink-0 ${
                      u.role === 'admin' ? 'bg-primary' : 'bg-accent'
                    }`}>
                      {(u.display_name || u.username).charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span title={u.display_name || u.username} className="text-sm font-medium text-text break-words">
                          {u.display_name || u.username}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                          u.role === 'admin'
                            ? 'border-primary text-primary'
                            : 'border-border text-text-muted'
                        }`}>
                          {u.role}
                        </span>
                        {!u.is_active && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger/15 text-danger">
                            {t.userDisabled}
                          </span>
                        )}
                      </div>
                      <div title={u.username} className="text-xs text-text-muted break-all">{u.username}</div>
                    </div>

                    {/* Stats */}
                    <div className="flex gap-4 shrink-0 text-center">
                      <div>
                        <div className="text-sm font-semibold text-text">{u.session_count}</div>
                        <div className="text-[10px] text-text-muted">{t.sessions}</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">{u.project_count}</div>
                        <div className="text-[10px] text-text-muted">{t.projects}</div>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">{formatNumber(u.total_data_points)}</div>
                        <div className="text-[10px] text-text-muted">{t.dataPoints}</div>
                      </div>
                    </div>

                    {/* Last upload */}
                    <div className="shrink-0 text-right w-36">
                      {lastSession ? (
                        <>
                          <div aria-label={lastSession.raw_filename || lastSession.session_id} title={lastSession.raw_filename || lastSession.session_id} className="text-xs text-text break-all">{lastSession.raw_filename || lastSession.session_id}</div>
                          <div className="text-[10px] text-text-muted">
                            {new Date(lastSession.created_at).toLocaleDateString()}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-text-muted">{t.noSessionsYet}</div>
                      )}
                    </div>

                    {/* Arrow */}
                    <div className="text-text-muted shrink-0">&rsaquo;</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Member Detail View ═══ */}
      {subTab === 'dashboard' && selectedMember && (
        <MemberDetail user={selectedMember} onBack={() => setSelectedMember(null)} />
      )}
      </div>

      {/* ═══ Users Tab ═══ */}
      <div id="admin-users-panel" role="tabpanel" aria-labelledby="admin-users-tab" hidden={subTab !== 'users'}>
      {subTab === 'users' && (
        <div className="max-w-4xl">
          <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text">{t.userManagement}</h2>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-3 py-1.5 bg-primary text-on-primary rounded text-sm hover:opacity-90 transition-opacity"
            >
              {showCreate ? t.cancel : t.newUser}
            </button>
          </div>

          {showCreate && (
            <CreateUserForm onCreated={() => { setShowCreate(false); loadUsers(); loadDashboard(); }} />
          )}

          {users.length === 0 && <p className="text-sm text-text-muted text-center py-6">{t.noUsers}</p>}
          {users.length > 0 && <div role="region" aria-label={t.userManagement} tabIndex={0} className="max-w-full overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border text-text-muted text-left">
                <th className="py-2 px-3">{t.username}</th>
                <th className="py-2 px-3">{t.displayName}</th>
                <th className="py-2 px-3">{t.role}</th>
                <th className="py-2 px-3">{t.status}</th>
                <th className="py-2 px-3">{t.created}</th>
                <th className="py-2 px-3">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                return (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-bg/50">
                    <td title={u.username} className="py-2 px-3 text-text font-medium break-words">
                      {u.username}
                      {isSelf && <span className="ml-1 text-xs text-text-muted">({t.you})</span>}
                    </td>
                    <td title={u.display_name || undefined} className="py-2 px-3 text-text break-words">{u.display_name || '-'}</td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => !isSelf && handleToggleRole(u)}
                        disabled={isSelf}
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          u.role === 'admin'
                            ? 'border-primary text-primary'
                            : 'border-border text-text-muted'
                        } ${isSelf ? 'opacity-50 cursor-default' : 'cursor-pointer hover:opacity-80'}`}
                      >
                        {u.role}
                      </button>
                    </td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => !isSelf && handleToggleActive(u)}
                        disabled={isSelf}
                        className={`text-xs ${
                          u.is_active ? 'text-success' : 'text-danger'
                        } ${isSelf ? 'opacity-50 cursor-default' : 'cursor-pointer hover:opacity-80'}`}
                      >
                        {u.is_active ? t.userActive : t.userDisabled}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-text-muted">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="py-2 px-3">
                      {!isSelf && (
                        <button
                          onClick={() => handleDelete(u.id, u.username)}
                          className="text-xs text-danger hover:opacity-80 cursor-pointer"
                        >
                          {t.delete}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>}
        </div>
      )}
      </div>
    </div>
  );
}

// ─── Member Detail ─────────────────────────────────────────────────────────────

function MemberDetail({ user, onBack }: { user: AdminDashboardUser; onBack: () => void }) {
  const { t } = useI18n();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="px-3 py-1.5 bg-surface border border-border rounded text-sm font-medium text-text hover:bg-bg"
        >
          &larr; {t.backToOverview}
        </button>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-on-primary text-sm font-bold ${
          user.role === 'admin' ? 'bg-primary' : 'bg-accent'
        }`}>
          {(user.display_name || user.username).charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="text-base font-semibold text-text">{user.display_name || user.username}</div>
          <div className="text-xs text-text-muted">{user.username}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${
          user.role === 'admin'
            ? 'border-primary text-primary'
            : 'border-border text-text-muted'
        }`}>
          {user.role}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="panel text-center">
          <div className="text-xl font-bold text-primary">{user.session_count}</div>
          <div className="text-xs text-text-muted">{t.ownedSessions}</div>
        </div>
        <div className="panel text-center">
          <div className="text-xl font-bold text-accent">{user.project_count}</div>
          <div className="text-xs text-text-muted">{t.ownedProjects}</div>
        </div>
        <div className="panel text-center">
          <div className="text-xl font-bold text-text">{formatNumber(user.total_data_points)}</div>
          <div className="text-xs text-text-muted">{t.dataPoints}</div>
        </div>
      </div>

      {/* Sessions table */}
      <div className="panel mb-4">
        <h3 className="text-sm font-semibold text-text mb-3">{t.ownedSessions} ({user.sessions.length})</h3>
        {user.sessions.length > 0 ? (
          <div role="region" aria-label={t.ownedSessions} tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-left">
                <th className="py-2 px-3">{t.session}</th>
                <th className="py-2 px-3">{t.filename}</th>
                <th className="py-2 px-3">{t.instrument}</th>
                <th className="py-2 px-3">{t.wells}</th>
                <th className="py-2 px-3">{t.cycles}</th>
                <th className="py-2 px-3">{t.created}</th>
              </tr>
            </thead>
            <tbody>
              {user.sessions.map((s) => (
                <tr key={s.session_id} className="border-b border-border/50">
                  <td aria-label={s.session_id} title={s.session_id} className="py-2 px-3 font-mono text-xs text-text break-all">{s.session_id}</td>
                  <td title={s.raw_filename || undefined} className="py-2 px-3 text-text text-xs break-all max-w-48">{s.raw_filename || '-'}</td>
                  <td className="py-2 px-3 text-text">{s.instrument}</td>
                  <td className="py-2 px-3 text-text">{s.num_wells}</td>
                  <td className="py-2 px-3 text-text">{s.num_cycles}</td>
                  <td className="py-2 px-3 text-text-muted text-xs">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="text-text-muted text-sm text-center py-4">{t.noSessionsYet}</div>
        )}
      </div>

      {/* Projects table */}
      <div className="panel">
        <h3 className="text-sm font-semibold text-text mb-3">{t.ownedProjects} ({user.projects.length})</h3>
        {user.projects.length > 0 ? (
          <div role="region" aria-label={t.ownedProjects} tabIndex={0} className="max-w-full overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted text-left">
                <th className="py-2 px-3">{t.projects}</th>
                <th className="py-2 px-3">{t.sessions}</th>
                <th className="py-2 px-3">{t.created}</th>
              </tr>
            </thead>
            <tbody>
              {user.projects.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td title={p.name} className="py-2 px-3 text-text font-medium break-words">{p.name}</td>
                  <td className="py-2 px-3 text-text">{p.session_count}</td>
                  <td className="py-2 px-3 text-text-muted text-xs">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="text-text-muted text-sm text-center py-4">{t.noProjectsForUser}</div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Create User Form ──────────────────────────────────────────────────────────

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useI18n();
  const owner = useOwnedOperation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ticket = owner.begin();
    setError('');
    setLoading(true);
    try {
      await createUser({ username, password, display_name: displayName || undefined, role });
      if (owner.current(ticket)) onCreated();
    } catch {
      if (owner.current(ticket)) setError(t.createFailed);
    } finally {
      if (owner.current(ticket)) setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-bg border border-border rounded p-4 mb-4 flex gap-3 items-end flex-wrap">
      <div>
        <label className="block text-xs text-text-muted mb-1">{t.username}</label>
        <input
          aria-label={t.username} autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-32 focus:outline-none focus:border-primary"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t.password}</label>
        <input
          aria-label={t.password} autoComplete="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-32 focus:outline-none focus:border-primary"
          required
          minLength={12}
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t.displayName}</label>
        <input
          aria-label={t.displayName} autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-36 focus:outline-none focus:border-primary"
          placeholder={t.optional}
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t.role}</label>
        <select
          aria-label={t.role}
          value={role}
          onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text focus:outline-none focus:border-primary"
        >
          <option value="user">{t.roleUser}</option>
          <option value="admin">{t.roleAdmin}</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-1.5 bg-primary text-on-primary rounded text-sm hover:opacity-90 disabled:opacity-50"
      >
        {loading ? t.creating : t.create}
      </button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </form>
  );
}

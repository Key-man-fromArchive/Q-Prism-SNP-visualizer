import { useEffect, useState } from 'react';
import type { UserListItem } from '@/types/auth';
import { getUsers, createUser, updateUser, deleteUser } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function UserManagement() {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  const loadUsers = async () => {
    try {
      const res = await getUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`Delete user "${username}"? Their data will be reassigned to you.`)) return;
    try {
      await deleteUser(userId);
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleToggleActive = async (user: UserListItem) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleToggleRole = async (user: UserListItem) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUser(user.id, { role: newRole });
      await loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  if (loading) return <div className="p-6 text-text-muted">Loading users...</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text">User Management</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-primary text-white rounded text-sm hover:opacity-90 transition-opacity"
        >
          {showCreate ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {showCreate && (
        <CreateUserForm onCreated={() => { setShowCreate(false); loadUsers(); }} />
      )}

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-text-muted text-left">
            <th className="py-2 px-3">Username</th>
            <th className="py-2 px-3">Display Name</th>
            <th className="py-2 px-3">Role</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3">Created</th>
            <th className="py-2 px-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            return (
              <tr key={u.id} className="border-b border-border/50 hover:bg-bg/50">
                <td className="py-2 px-3 text-text font-medium">
                  {u.username}
                  {isSelf && <span className="ml-1 text-xs text-text-muted">(you)</span>}
                </td>
                <td className="py-2 px-3 text-text">{u.display_name || '-'}</td>
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
                      u.is_active ? 'text-green-600' : 'text-red-500'
                    } ${isSelf ? 'opacity-50 cursor-default' : 'cursor-pointer hover:opacity-80'}`}
                  >
                    {u.is_active ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="py-2 px-3 text-text-muted">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                </td>
                <td className="py-2 px-3">
                  {!isSelf && (
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                      className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createUser({ username, password, display_name: displayName || undefined, role });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-bg border border-border rounded p-4 mb-4 flex gap-3 items-end flex-wrap">
      <div>
        <label className="block text-xs text-text-muted mb-1">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-32 focus:outline-none focus:border-primary"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-32 focus:outline-none focus:border-primary"
          required
          minLength={4}
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Display Name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text w-36 focus:outline-none focus:border-primary"
          placeholder="Optional"
        />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
          className="px-2 py-1.5 bg-surface border border-border rounded text-sm text-text focus:outline-none focus:border-primary"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-3 py-1.5 bg-primary text-white rounded text-sm hover:opacity-90 disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Create'}
      </button>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </form>
  );
}

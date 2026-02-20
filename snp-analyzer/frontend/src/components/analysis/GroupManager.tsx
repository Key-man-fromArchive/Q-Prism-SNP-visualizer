import { useState, useEffect, useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useSelectionStore } from "@/stores/selection-store";
import {
  getWellGroups,
  createWellGroup,
  deleteWellGroup,
} from "@/lib/api";

type GroupInfo = { wells: string[]; source: "parsed" | "manual" };

type GroupManagerProps = {
  sessionId: string;
  onClose: () => void;
};

export function GroupManager({ sessionId, onClose }: GroupManagerProps) {
  const [groups, setGroups] = useState<Record<string, GroupInfo>>({});
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const setWellGroups = useSessionStore((s) => s.setWellGroups);
  const selectedWells = useSelectionStore((s) => s.selectedWells);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await getWellGroups(sessionId);
      setGroups(res.groups);
      // Sync to session store
      const merged: Record<string, string[]> = {};
      for (const [name, info] of Object.entries(res.groups)) {
        merged[name] = info.wells;
      }
      setWellGroups(Object.keys(merged).length > 0 ? merged : null);
    } catch {
      // ignore
    }
  }, [sessionId, setWellGroups]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async () => {
    if (!newName.trim() || selectedWells.length === 0) return;
    setLoading(true);
    try {
      await createWellGroup(sessionId, newName.trim(), selectedWells);
      setNewName("");
      await fetchGroups();
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    setLoading(true);
    try {
      await deleteWellGroup(sessionId, name);
      await fetchGroups();
    } catch (err) {
      console.error("Failed to delete group:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-lg border border-border shadow-xl"
        style={{ width: 400, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text">Well Groups</h3>
          <button
            className="text-text-muted hover:text-text cursor-pointer bg-transparent border-none text-lg"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Existing groups */}
          {Object.keys(groups).length === 0 && (
            <p className="text-xs text-text-muted">No groups defined yet.</p>
          )}
          {Object.entries(groups).map(([name, info]) => (
            <div
              key={name}
              className="flex items-center justify-between px-3 py-2 rounded border border-border"
            >
              <div>
                <span className="text-sm text-text font-medium">{name}</span>
                <span className="text-xs text-text-muted ml-2">
                  ({info.wells.length} wells)
                </span>
                <span
                  className="text-[10px] ml-1"
                  style={{
                    color:
                      info.source === "parsed" ? "var(--primary)" : "var(--accent)",
                  }}
                >
                  {info.source}
                </span>
              </div>
              {info.source === "manual" && (
                <button
                  className="text-xs text-danger hover:underline cursor-pointer bg-transparent border-none"
                  onClick={() => handleDelete(name)}
                  disabled={loading}
                >
                  Delete
                </button>
              )}
            </div>
          ))}

          {/* Create new group */}
          <div className="border-t border-border pt-3">
            <p className="text-xs text-text-muted mb-2">
              Select wells on the plate (drag), then name the group:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 px-2 py-1 border border-border rounded text-sm bg-surface text-text"
                placeholder="Group name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                className="px-3 py-1 text-xs rounded bg-primary text-white border-none cursor-pointer disabled:opacity-50"
                onClick={handleCreate}
                disabled={
                  loading || !newName.trim() || selectedWells.length === 0
                }
              >
                Create
              </button>
            </div>
            {selectedWells.length > 0 && (
              <p className="text-[10px] text-text-muted mt-1">
                {selectedWells.length} well(s) selected: {selectedWells.slice(0, 8).join(", ")}
                {selectedWells.length > 8 ? "..." : ""}
              </p>
            )}
            {selectedWells.length === 0 && (
              <p className="text-[10px] text-text-muted mt-1">
                No wells selected. Drag-select wells on the plate first.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

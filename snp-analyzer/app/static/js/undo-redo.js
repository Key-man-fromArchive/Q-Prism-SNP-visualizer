/**
 * Undo/Redo for welltype assignments.
 * Snapshot-based: stores full welltype state per action.
 */

const MAX_HISTORY = 50;
let history = [];  // array of welltype snapshots (each is a Map-like {well: type})
let historyIndex = -1;
let undoRedoSessionId = null;
let _isApplying = false;  // guard to prevent re-entrant snapshots during undo/redo

export function initUndoRedo(sid) {
    undoRedoSessionId = sid;
    history = [];
    historyIndex = -1;
}

export function pushSnapshot(welltypes) {
    // Skip if this event was triggered by an undo/redo apply
    if (_isApplying) return;
    // Truncate any redo history
    history = history.slice(0, historyIndex + 1);
    // Deep copy
    history.push(JSON.parse(JSON.stringify(welltypes)));
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
    historyIndex = history.length - 1;
    updateUndoRedoButtons();
}

export function canUndo() {
    return historyIndex > 0;
}

export function canRedo() {
    return historyIndex < history.length - 1;
}

export async function undo() {
    if (!canUndo() || !undoRedoSessionId) return;
    historyIndex--;
    const snapshot = history[historyIndex];
    await applySnapshot(snapshot);
    updateUndoRedoButtons();
}

export async function redo() {
    if (!canRedo() || !undoRedoSessionId) return;
    historyIndex++;
    const snapshot = history[historyIndex];
    await applySnapshot(snapshot);
    updateUndoRedoButtons();
}

async function applySnapshot(snapshot) {
    // Bulk replace welltypes via API
    _isApplying = true;
    try {
        const res = await fetch(`/api/data/${undoRedoSessionId}/welltypes/bulk`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignments: snapshot }),
        });
        if (res.ok) {
            document.dispatchEvent(new Event("welltypes-changed"));
        }
    } catch (err) {
        console.error("Undo/redo apply failed:", err);
    } finally {
        _isApplying = false;
    }
}

function updateUndoRedoButtons() {
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");
    if (undoBtn) undoBtn.disabled = !canUndo();
    if (redoBtn) redoBtn.disabled = !canRedo();
}

// Keyboard handler
export function handleUndoRedoKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === "Z" || e.key === "y")) {
        e.preventDefault();
        redo();
    }
}

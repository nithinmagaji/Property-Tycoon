import { normalizeAssetStore } from "./engine.js";

/** Strip nested undo payloads and transient flags so saves stay small and consistent. */
function compactUndoEntry(entry) {
  if (typeof entry !== "string") return entry;
  try {
    const o = JSON.parse(entry);
    o.animating = false;
    o.undoStack = [];
    return JSON.stringify(o);
  } catch {
    return entry;
  }
}

export function snapshotForPersist(game, { undoStack = null } = {}) {
  normalizeAssetStore(game);
  const copy = JSON.parse(JSON.stringify(game));
  copy.animating = false;
  copy.version = copy.version ?? 3;
  if (Array.isArray(undoStack ?? copy.undoStack)) {
    const stack = undoStack ?? copy.undoStack;
    copy.undoStack = stack.slice(-12).map(compactUndoEntry);
  } else {
    copy.undoStack = [];
  }
  return copy;
}

export function snapshotForUndo(game) {
  const stack = (game.undoStack || []).slice();
  const snap = snapshotForPersist(game, { undoStack: stack });
  return snap;
}

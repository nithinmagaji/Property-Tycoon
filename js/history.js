/** Undo stack for human moves (local / hot-seat). */

import { snapshotForUndo } from "./persist.js";

export function pushUndoState(game) {
  if (!game.undoStack) game.undoStack = [];
  const snap = snapshotForUndo(game);
  game.undoStack.push(JSON.stringify(snap));
  if (game.undoStack.length > 12) game.undoStack.shift();
}

export function canUndo(game, seat, { rolling = false } = {}) {
  if (rolling || game.animating) return false;
  if (!game.undoStack?.length) return false;
  if (game.pending || game.auction) return false;
  const p = game.players[seat];
  return p && !p.bot && !game.done && !game.paused;
}

export function popUndoState(game) {
  const raw = game.undoStack?.pop();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

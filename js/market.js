import { BOARD } from "./data.js";
import { asset } from "./engine.js";

export function markPropertyBuy(game) {
  if (!game.market) game.market = { staleRounds: 0 };
  game.market.buysSinceCheck = true;
}

export function onRoundCompleted(game) {
  if (!game.market) game.market = { staleRounds: 0, buysSinceCheck: false };
  if (game.market.buysSinceCheck) {
    game.market.staleRounds = 0;
    game.market.buysSinceCheck = false;
  } else {
    game.market.staleRounds++;
  }
  return game.market.staleRounds;
}

export function unsoldPropertyIndices(game) {
  return BOARD.map((g, i) => (g[2] > 0 && asset(game, i).owner === null ? i : -1)).filter((i) => i >= 0);
}

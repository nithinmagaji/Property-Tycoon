import { BOARD, groupOf } from "./data.js";
import {
  asset,
  playerIndex,
  ownsSet,
  worth,
  buyProperty,
  rentAmount,
  canBuildOn,
  buildHouse,
  reconcileOwnership,
  minimumTradePrice,
} from "./engine.js";

function monopolyPressure(game, botIdx, spaceIndex) {
  const gr = groupOf(spaceIndex);
  if (!gr) return 0;
  let score = 0;
  for (const j of gr[1]) {
    const o = asset(game, j).owner;
    if (o === botIdx) score += 2;
    else if (o !== null && o !== botIdx) score -= 1.5;
  }
  return score;
}

function isAtlas(p) {
  return p.name === "Atlas" || (p.personality === "builder" && p.bot);
}

export function botShouldBuy(game, p, i) {
  const g = BOARD[i];
  const cost = g[2];
  let reserve =
    p.personality === "builder" ? 60 : p.personality === "trader" ? 120 : 100;
  if (isAtlas(p)) reserve = 40;
  if (p.cash < cost + reserve) return false;
  const pressure = monopolyPressure(game, playerIndex(game, p), i);
  let willingness =
    p.personality === "builder" ? 0.88 : p.personality === "trader" ? 0.68 : 0.74;
  if (isAtlas(p)) willingness = 0.92;
  willingness += pressure * 0.1;
  const futureRent = rentAmount(game, i) / cost;
  willingness += Math.min(0.18, futureRent * 0.025);
  const hard = game.settings.difficulty === "hard";
  const roll = Math.random();
  const threshold = hard ? 0.28 : 0.38;
  return roll < willingness - threshold * (1 - willingness);
}

export function botDevelop(game, p, say) {
  if (p.personality === "trader" && Math.random() > 0.7) return;
  const buildable = p.props.filter((i) => canBuildOn(game, p, i));
  buildable.sort((a, b) => BOARD[b][2] - BOARD[a][2]);
  for (const i of buildable) {
    if (p.personality === "builder" || ownsSet(game, p, i)) {
      if (buildHouse(game, p, i, say)) return;
    }
  }
}

export function botTradeEvaluate(game, bot, cash, propIndex) {
  let val = minimumTradePrice(game, propIndex);
  const fair = BOARD[propIndex][2];
  const gr = groupOf(propIndex);
  if (gr) {
    const owned = gr[1].filter((j) => asset(game, j).owner === playerIndex(game, bot)).length;
    val += owned * fair * 0.25;
  }
  if (bot.personality === "builder") val *= 1.15;
  if (bot.personality === "trader") val *= 0.88;
  const hard = game.settings.difficulty === "hard";
  const noise = hard ? 0.05 : 0.15;
  return val * (1 - noise + Math.random() * noise * 2);
}

/** Chance a bot starts an auction instead of passing (by difficulty setting). */
function botAuctionRate(game) {
  const d = game.settings?.difficulty || "normal";
  if (d === "easy") return 0.15 + Math.random() * 0.05;
  if (d === "hard") return 0.05 + Math.random() * 0.05;
  return 0.1 + Math.random() * 0.05;
}

/** Buy when interested; otherwise usually pass — auctions are occasional, not default. */
export function botBuyOrAuction(game, p, i, say, startAuction) {
  const idx = playerIndex(game, p);
  const willing = botShouldBuy(game, p, i);

  if (willing) {
    const buyBias = isAtlas(p)
      ? 0.96
      : p.personality === "builder"
        ? 0.9
        : p.personality === "trader"
          ? 0.82
          : 0.86;
    if (Math.random() < buyBias) {
      buyProperty(game, p, i, say);
      return "buy";
    }
  }

  if (game.settings.auction && Math.random() < botAuctionRate(game)) {
    say(`${p.name} declined ${BOARD[i][0]}; auction begins.`);
    startAuction(i, idx);
    return "auction";
  }
  say(`${p.name} passed on ${BOARD[i][0]}.`);
  return "pass";
}

/** Bots skip some auction rounds so the human isn't fighting three bidders every time. */
/** Pick a random property trade (not yet executed). */
export function pickBotPropertyTrade(game) {
  if (Math.random() > 0.14) return null;
  const sellers = game.players.filter((p) => !p.bankrupt && !p.inactive && p.props.length > 1);
  const buyers = game.players.filter((p) => !p.bankrupt && !p.inactive);
  if (!sellers.length || buyers.length < 2) return null;
  const seller = sellers[Math.floor(Math.random() * sellers.length)];
  const prop = seller.props[Math.floor(Math.random() * seller.props.length)];
  const others = buyers.filter((b) => b !== seller);
  const buyer = others[Math.floor(Math.random() * others.length)];
  const min = minimumTradePrice(game, prop);
  const price = Math.max(min, Math.round(BOARD[prop][2] * (0.85 + Math.random() * 0.25)));
  if (buyer.cash < price) return null;
  return { buyer, seller, prop, price };
}

export function botAuctionBidChance(game, p, auction) {
  const base =
    p.personality === "builder" ? 0.62 : p.personality === "trader" ? 0.48 : 0.55;
  const hard = game.settings.difficulty === "hard" ? 0.15 : game.settings.difficulty === "easy" ? -0.08 : 0;
  let chance = base + hard;
  if (auction.leader !== null && !game.players[auction.leader].bot) {
    chance -= 0.05;
  }
  const livingBots = game.players.filter((x) => x.bot && !x.bankrupt).length;
  if (livingBots >= 2) chance *= 0.92;
  if (auction.current === auction.leader) return false;
  if (auction.bankMediated) chance += 0.08;
  return Math.random() < chance;
}

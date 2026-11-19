import {
  BOARD,
  COLOR_GROUPS,
  RAIL_INDICES,
  UTIL_INDICES,
  RENT_TABLE,
  HOUSE_COST,
  minimumRentForIndex,
  money,
  MORTGAGE_FRACTION,
  UNMORTGAGE_INTEREST,
  SELL_BUILDING_FRACTION,
  BUILDING_RENT_FRACTIONS,
  MORTGAGE_FORECLOSURE_ROUNDS,
  MIN_RENT_FRACTION,
  JAIL_INDEX,
  GO_INDEX,
  GO_TO_JAIL,
  INCOME_TAX,
  LUXURY_TAX,
  FREE_PARKING,
  groupOf,
  groupKey,
  isProperty,
  freshGame,
} from "./data.js";
import { cardForDiceTotal, initDiceCardMaps } from "./cards.js";
import { markPropertyBuy } from "./market.js";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function initDecks(game) {
  initDiceCardMaps(game);
}

export function asset(game, i) {
  const key = Number(i);
  if (game.assets?.[key]) return game.assets[key];
  return (game.assets[key] = {
    owner: null,
    houses: 0,
    mortgaged: false,
    mortgagedRound: null,
    mortgagePrincipal: 0,
  });
}

/** Keep `assets[].owner` and `player.props` in sync (fixes “sold but still available”). */
export function reconcileOwnership(game) {
  if (!game?.players || !game.assets) return;
  const priced = BOARD.map((g, i) => (g[2] > 0 ? i : -1)).filter((i) => i >= 0);

  priced.forEach((i) => {
    const a = asset(game, i);
    if (a.owner !== null) {
      const o = a.owner;
      if (o < 0 || o >= game.players.length || game.players[o]?.bankrupt) {
        a.owner = null;
      }
    }
  });

  priced.forEach((i) => {
    const a = asset(game, i);
    if (a.owner === null) {
      const holders = game.players
        .map((p, j) => (p.props?.includes(i) ? j : -1))
        .filter((j) => j >= 0);
      if (holders.length === 1) a.owner = holders[0];
      else if (holders.length > 1) {
        a.owner = holders[0];
        holders.slice(1).forEach((j) => {
          game.players[j].props = game.players[j].props.filter((x) => x !== i);
        });
      }
    }
  });

  priced.forEach((i) => {
    const a = asset(game, i);
    const o = a.owner;
    if (o === null) {
      game.players.forEach((p) => {
        p.props = (p.props || []).filter((x) => x !== i);
      });
      return;
    }
    game.players.forEach((p, j) => {
      if (!p.props) p.props = [];
      if (j === o) {
        if (!p.props.includes(i)) p.props.push(i);
      } else {
        p.props = p.props.filter((x) => x !== i);
      }
    });
  });

  game.players.forEach((p) => {
    p.props = [...new Set((p.props || []).filter((i) => priced.includes(i)))];
  });
}

export function normalizeAssetStore(game) {
  if (!game.assets || typeof game.assets !== "object") {
    game.assets = {};
    return;
  }
  const next = {};
  for (const [k, v] of Object.entries(game.assets)) {
    const idx = Number(k);
    if (!Number.isFinite(idx)) continue;
    next[idx] = {
      owner: v?.owner ?? null,
      houses: v?.houses ?? 0,
      mortgaged: !!v?.mortgaged,
      mortgagedRound: v?.mortgagedRound ?? null,
      mortgagePrincipal: money(v?.mortgagePrincipal ?? 0),
    };
  }
  game.assets = next;
}

export function playerIndex(game, p) {
  return game.players.indexOf(p);
}

export function buildingSellValue(i, houses) {
  const hc = houseCostFor(i);
  if (!houses) return 0;
  if (houses === 5) return money(hc * 5 * SELL_BUILDING_FRACTION);
  return money(houses * hc * SELL_BUILDING_FRACTION);
}

export function buildingsOnSpaceValue(game, i) {
  const a = asset(game, i);
  return buildingSellValue(i, a.houses);
}

export function propertyEquityValue(game, i) {
  const a = asset(game, i);
  const price = BOARD[i][2];
  const bldg = buildingsOnSpaceValue(game, i);
  if (a.mortgaged) {
    return money(price + bldg - unmortgageCostForAsset(a, i));
  }
  return money(price + bldg);
}

export function worth(game, p) {
  return money(
    p.cash +
      p.props.reduce((v, i) => v + propertyEquityValue(game, i), 0)
  );
}

export function activePropertyCount(game, p) {
  return p.props.filter((i) => !asset(game, i).mortgaged).length;
}

export function worthLeaderPercent(game, p) {
  const pool = game.players.filter((x) => !x.bankrupt && !x.inactive);
  const maxW = Math.max(1, ...pool.map((x) => worth(game, x)));
  return money((worth(game, p) / maxW) * 100);
}

export function ownsSet(game, p, i) {
  const gr = groupOf(i);
  if (!gr) return false;
  const idx = playerIndex(game, p);
  return gr[1].every((j) => asset(game, j).owner === idx);
}

export function setMortgaged(game, gr) {
  return gr[1].some((j) => asset(game, j).mortgaged);
}

export function rentAmount(game, i) {
  const a = asset(game, i);
  if (a.owner === null || a.mortgaged) return 0;
  const owner = game.players[a.owner];
  const g = BOARD[i];
  const key = g[4];
  if (key === "rail") {
    const n = owner.props.filter((j) => RAIL_INDICES.includes(j)).length;
    let rent = [0, 25, 50, 100, 200][n];
    const utils = owner.props.filter((j) => UTIL_INDICES.includes(j)).length;
    if (n && utils) {
      rent = money(rent * (1 + 0.35 * utils) + 50 * Math.min(n, utils));
    }
    return rent;
  }
  if (key === "util") {
    const n = owner.props.filter((j) => UTIL_INDICES.includes(j)).length;
    const rails = owner.props.filter((j) => RAIL_INDICES.includes(j)).length;
    let mult = n === 2 ? 10 : 4;
    if (rails) mult += rails * 2;
    return money((game.lastRoll || 7) * mult);
  }
  if (isProperty(i)) {
    const price = g[2];
    const floor = minimumRentForIndex(i);
    if (a.houses) {
      const frac = BUILDING_RENT_FRACTIONS[a.houses] ?? BUILDING_RENT_FRACTIONS[5];
      return Math.max(money(price * frac), floor);
    }
    const site = Math.max(floor, money(price * MIN_RENT_FRACTION));
    return ownsSet(game, owner, i) ? money(site * 2) : site;
  }
  return money(g[3] || 0);
}

export function houseCostFor(i) {
  return HOUSE_COST[groupKey(i)] || 50;
}

export function canBuildOn(game, p, i) {
  return !buildBlockReason(game, p, i);
}

/** Why houses/hotels cannot be built (null = allowed). */
export function buildBlockReason(game, p, i) {
  const a = asset(game, i);
  if (!isProperty(i)) return "Not a buildable property";
  if (a.owner !== playerIndex(game, p)) return "You do not own this space";
  if (a.mortgaged) return "Unmortgage before building";
  if (a.houses >= 5) return "Hotel already built";
  const cost = houseCostFor(i);
  if (p.cash < cost) return `Need $${cost} cash`;
  if (a.houses === 4) {
    if (game.bank.hotels < 1) return "No hotels in bank";
    if (game.bank.houses < 4) return "Need 4 houses in bank for hotel swap";
  } else if (game.bank.houses < 1) return "No houses in bank";
  return null;
}

export function canSellOn(game, p, i) {
  const a = asset(game, i);
  if (a.owner !== playerIndex(game, p) || !a.houses) return false;
  return isProperty(i);
}

export function sellBlockReason(game, p, i) {
  const a = asset(game, i);
  if (a.owner !== playerIndex(game, p) || !a.houses) return "No buildings to sell";
  if (!isProperty(i)) return "Cannot sell here";
  return null;
}

export function buildHouse(game, p, i, say) {
  if (!canBuildOn(game, p, i)) return false;
  const a = asset(game, i);
  const cost = houseCostFor(i);
  p.cash -= cost;
  if (a.houses === 4) {
    game.bank.houses += 4;
    game.bank.hotels--;
    game.bank.houses -= 4;
    a.houses = 5;
  } else {
    game.bank.houses--;
    a.houses++;
  }
  game.stats.builds++;
  const label =
    a.houses === 5 ? "hotel 🏨" : a.houses === 1 ? "1 house 🏠" : `${a.houses} houses 🏠`;
  say(`${p.name} built on ${BOARD[i][0]} (${label}).`);
  return true;
}

export function sellBuilding(game, p, i, say) {
  const a = asset(game, i);
  if (!canSellOn(game, p, i)) return false;
  const hc = houseCostFor(i);
  const payout = money(hc * SELL_BUILDING_FRACTION);
  if (a.houses === 5) {
    a.houses = 4;
    game.bank.hotels++;
    game.bank.houses -= 4;
    p.cash += payout;
  } else {
    a.houses--;
    game.bank.houses++;
    p.cash += payout;
  }
  say(`${p.name} sold a building on ${BOARD[i][0]} to the bank for $${payout}.`);
  return true;
}

export function mortgageValue(i) {
  return money(BOARD[i][2] * MORTGAGE_FRACTION);
}

export function unmortgageCostForAsset(a, i) {
  const principal = a.mortgagePrincipal > 0 ? a.mortgagePrincipal : mortgageValue(i);
  return money(principal * (1 + UNMORTGAGE_INTEREST));
}

export function unmortgageCost(i, game = null) {
  if (game) return unmortgageCostForAsset(asset(game, i), i);
  return unmortgageCostForAsset({ mortgagePrincipal: mortgageValue(i) }, i);
}

export function minimumTradePrice(game, propIndex) {
  const a = asset(game, propIndex);
  const base = BOARD[propIndex][2];
  const bldg = buildingSellValue(propIndex, a.houses);
  if (a.mortgaged) {
    // Buyer must cover bank payoff (principal + 5%); buildings still add to floor.
    return money(unmortgageCostForAsset(a, propIndex) + bldg);
  }
  return money(base + bldg);
}

export function mortgageProperty(game, p, i, say) {
  if (!p.props.includes(i)) return false;
  const a = asset(game, i);
  if (a.mortgaged || a.houses) return false;
  const v = mortgageValue(i);
  a.mortgaged = true;
  a.mortgagePrincipal = v;
  a.mortgagedRound = game.round ?? 1;
  p.cash += v;
  game.stats.mortgages++;
  say?.(`${p.name} mortgaged ${BOARD[i][0]} to the bank for $${v}.`);
  return true;
}

export function unmortgageProperty(game, p, i, say) {
  if (!p.props.includes(i)) return false;
  const a = asset(game, i);
  if (!a.mortgaged) return false;
  const c = unmortgageCostForAsset(a, i);
  if (p.cash < c) return false;
  p.cash -= c;
  a.mortgaged = false;
  a.mortgagePrincipal = 0;
  a.mortgagedRound = null;
  game.stats.taxes += money(c - mortgageValue(i));
  say?.(`${p.name} paid $${c} to unmortgage ${BOARD[i][0]}.`);
  return true;
}

/** Mortgaged 5+ rounds without unmortgage → bank auction. */
export function checkMortgageForeclosures(game, startAuction, say) {
  if (!startAuction) return;
  const round = game.round ?? 1;
  const doomed = [];
  for (const [key, raw] of Object.entries(game.assets || {})) {
    const i = Number(key);
    const a = asset(game, i);
    if (!a.mortgaged || a.owner == null) continue;
    const since = a.mortgagedRound ?? round;
    if (round - since >= MORTGAGE_FORECLOSURE_ROUNDS) doomed.push(i);
  }
  for (const i of doomed) {
    const a = asset(game, i);
    const owner = game.players[a.owner];
    a.mortgaged = false;
    a.mortgagePrincipal = 0;
    a.mortgagedRound = null;
    owner.props = owner.props.filter((x) => x !== i);
    a.owner = null;
    say?.(
      `${BOARD[i][0]} was foreclosed (${MORTGAGE_FORECLOSURE_ROUNDS} rounds mortgaged) — bank auction.`
    );
    startAuction(i, null);
    reconcileOwnership(game);
    return;
  }
}

export function executePropertyTrade(game, buyer, seller, prop, price, say) {
  price = money(price);
  if (buyer.cash < price) return false;
  const a = asset(game, prop);
  if (a.owner !== playerIndex(game, seller)) return false;
  const min = minimumTradePrice(game, prop);
  if (price < min) {
    say?.(`Trade rejected — offer must be at least $${min} (deed + buildings + mortgage payoff).`);
    return false;
  }
  let bankCut = 0;
  if (a.mortgaged) {
    bankCut = unmortgageCostForAsset(a, prop);
    if (price < bankCut) {
      say?.(`Trade rejected — need at least $${bankCut} for the bank mortgage payoff.`);
      return false;
    }
    a.mortgaged = false;
    a.mortgagePrincipal = 0;
    a.mortgagedRound = null;
    game.stats.taxes += money(bankCut - mortgageValue(prop));
  }
  const toSeller = money(price - bankCut);
  buyer.cash -= price;
  seller.cash += toSeller;
  seller.props = seller.props.filter((i) => i !== prop);
  buyer.props.push(prop);
  a.owner = playerIndex(game, buyer);
  game.stats.trades++;
  reconcileOwnership(game);
  const mortNote = bankCut
    ? ` (bank mortgage payoff $${bankCut}, seller received $${toSeller})`
    : "";
  say(`🤝 Trade: ${buyer.name} bought ${BOARD[prop][0]} from ${seller.name} for $${price}.${mortNote}`);
  return true;
}

export function sendToJail(game, p, say) {
  p.pos = JAIL_INDEX;
  p.jail = 1;
  p.jailTurns = 0;
  p.doublesInRow = 0;
  say(`${p.name} was sent to Jail.`);
}

/** Jail with optional human choice to use Get Out of Jail Free. */
export function trySendToJail(game, p, ctx, reason = "sent to Jail") {
  if (p.getOutCards > 0 && !p.bot) {
    game.pending = { type: "jailFreeChoice", player: playerIndex(game, p), reason };
    ctx.onPending?.();
    return "pending";
  }
  if (p.getOutCards > 0 && p.bot) {
    p.getOutCards--;
    ctx.say(`${p.name} used a Get Out of Jail Free card (${reason}).`);
    return "card";
  }
  sendToJail(game, p, ctx.say);
  return "jail";
}

export function setPendingJailFreeUse(game, p) {
  game.pending = { type: "jailFreeChoice", player: playerIndex(game, p), reason: "Jail" };
}

export function advancePosition(game, p, total) {
  const old = p.pos;
  p.pos = (p.pos + total) % 40;
  if (p.pos < old) return 200;
  return 0;
}

export function drawCard(game, deckName) {
  const deck = game.decks[deckName];
  if (!deck.length) initDecks(game);
  const card = game.decks[deckName].shift();
  game.decks[deckName].push(card);
  return card;
}

export function repairCost(game, p, houseAmt, hotelAmt) {
  let total = 0;
  for (const i of p.props) {
    const h = asset(game, i).houses;
    if (h === 5) total += hotelAmt;
    else if (h) total += h * houseAmt;
  }
  return total;
}

export function runCard(game, p, card, ctx, deckKey) {
  const { say, gain, owe, land } = ctx;
  const deckLabel = deckKey === "chance" ? "Chance" : deckKey === "community" ? "Community Fund" : "Card";
  const diceTotal = game.lastRoll ?? 7;
  if (deckKey) {
    if (!game.lastDraw) game.lastDraw = {};
    game.lastDraw[deckKey] = {
      t: card.t,
      action: card.action,
      amount: card.amount,
      _id: card._id,
      diceTotal,
    };
  }
  say(`${p.name} — ${deckLabel} (dice ${diceTotal}): ${card.t}`);

  if (!card.action) {
    if (card.amount > 0) gain(p, card.amount, card.t);
    else if (card.amount < 0) owe(p, -card.amount, card.t);
    if (deckKey) ctx.onCardDraw?.(card, deckKey);
    return;
  }

  switch (card.action) {
    case "go":
      p.pos = GO_INDEX;
      gain(p, 200, card.t);
      land(p);
      break;
    case "back3":
      p.pos = (p.pos + 37) % 40;
      land(p);
      break;
    case "jail":
      trySendToJail(game, p, ctx, card.t);
      break;
    case "jailCard":
      p.getOutCards++;
      say(`${p.name} kept a Get Out of Jail Free card.`);
      break;
    case "repairs": {
      const h = card.house ?? 25;
      const ht = card.hotel ?? 100;
      const n = repairCost(game, p, h, ht);
      if (n) owe(p, n, "repairs");
      break;
    }
    case "rail":
    case "util": {
      const idx = card.index ?? 5;
      p.pos = idx;
      land(p);
      break;
    }
    case "payAll": {
      const each = Math.abs(card.amount ?? 50);
      game.players.forEach((other) => {
        if (other !== p && !other.bankrupt) owe(p, each, `paid ${other.name}`, playerIndex(game, other));
      });
      break;
    }
    case "collectAll": {
      const each = Math.abs(card.amount ?? 50);
      game.players.forEach((other) => {
        if (other !== p && !other.bankrupt) owe(other, each, `paid ${p.name}`, playerIndex(game, p));
      });
      break;
    }
    default:
      break;
  }
  if (deckKey) ctx.onCardDraw?.(card, deckKey);
}

export function declareBankrupt(game, p, creditor, say) {
  p.bankrupt = true;
  game.stats.bankruptcies++;
  const pi = playerIndex(game, p);
  if (creditor !== null && creditor !== undefined && creditor !== pi) {
    p.props.forEach((i) => {
      const a = asset(game, i);
      while (a.houses) sellBuilding(game, p, i, say);
      a.owner = creditor;
      game.players[creditor].props.push(i);
    });
    game.players[creditor].cash += Math.max(0, p.cash);
    say(`${p.name} went bankrupt; assets transferred to ${game.players[creditor].name}.`);
  } else {
    p.props.forEach((i) => {
      const a = asset(game, i);
      while (a.houses) {
        a.houses--;
        game.bank.houses++;
      }
      if (a.houses === 5) {
        a.houses = 0;
        game.bank.hotels++;
      }
      a.owner = null;
      a.mortgaged = false;
    });
    say(`${p.name} went bankrupt; properties returned to the bank.`);
  }
  p.props = [];
  p.cash = 0;
  const alive = game.players.filter((x) => !x.bankrupt);
  if (alive.length === 1) {
    game.done = true;
    const w = alive[0];
    say(`🏆 ${w.name} wins with net worth $${worth(game, w)}!`);
  }
}

/** Still has buildings to sell or unmortgaged tiles to mortgage. */
export function hasLiquidationOptions(game, p) {
  for (const i of p.props) {
    const a = asset(game, i);
    if (a.houses) return true;
    if (!a.mortgaged) return true;
  }
  return false;
}

/** Bankruptcy only after every owned property is mortgaged (no houses) and cash still cannot cover the debt. */
export function shouldDeclareBankrupt(game, p, amountOwed) {
  return p.cash < amountOwed && !hasLiquidationOptions(game, p);
}

/** Raise cash toward paying `amountOwed` (total due, not just the shortfall). */
export function autoLiquidate(game, p, amountOwed, say) {
  let guard = 0;
  while (p.cash < amountOwed && guard++ < 240) {
    let progressed = false;

    for (const i of [...p.props]) {
      if (p.cash >= amountOwed) return;
      const gr = groupOf(i);
      if (!gr) continue;
      const maxH = Math.max(...gr[1].map((j) => asset(game, j).houses));
      const hi = gr[1].find((j) => asset(game, j).houses === maxH && asset(game, j).houses);
      if (hi && sellBuilding(game, p, hi, say)) {
        progressed = true;
        break;
      }
    }
    if (p.cash >= amountOwed) return;
    if (progressed) continue;

    const unmortgaged = p.props
      .map((i) => ({ i, a: asset(game, i) }))
      .filter((x) => !x.a.mortgaged && !x.a.houses)
      .sort((a, b) => BOARD[a.i][2] - BOARD[b.i][2]);
    if (!unmortgaged.length) break;

    const x = unmortgaged[0];
    mortgageProperty(game, p, x.i, say);
  }
}

export function buyProperty(game, p, i, say) {
  const a = asset(game, i);
  const idx = playerIndex(game, p);
  if (a.owner !== null && a.owner !== idx) {
    say(`${BOARD[i][0]} is already owned.`);
    return false;
  }
  const cost = BOARD[i][2];
  if (p.cash < cost) {
    say(`${p.name} cannot afford ${BOARD[i][0]}.`);
    return false;
  }
  p.cash -= cost;
  if (!p.props.includes(i)) p.props.push(i);
  a.owner = idx;
  game.stats.buys++;
  markPropertyBuy(game);
  say(`${p.name} purchased ${BOARD[i][0]} for $${cost}.`);
  return true;
}

export function clearPending(game) {
  game.pending = null;
}

export function setPendingBuy(game, p, i) {
  game.pending = { type: "buy", space: i, player: playerIndex(game, p) };
}

export function setPendingJail(game, p) {
  game.pending = { type: "jail", player: playerIndex(game, p) };
}

export function setPendingTax(game, p) {
  game.pending = { type: "incomeTax", player: playerIndex(game, p) };
}

export function landOnSpace(game, p, ctx) {
  const i = p.pos;
  const g = BOARD[i];
  const idx = playerIndex(game, p);
  const a = asset(game, i);

  if (i === GO_INDEX) return;
  if (i === GO_TO_JAIL) {
    trySendToJail(game, p, ctx, "Go To Jail");
    return;
  }
  if (i === INCOME_TAX) {
    if (!p.bot) {
      setPendingTax(game, p);
      ctx.onPending?.();
      return;
    }
    const w = worth(game, p);
    const pct = Math.floor(w * 0.1);
    const tax = Math.min(200, pct);
    game.stats.taxes += tax;
    ctx.owe(p, tax, "income tax");
    return;
  }
  if (i === LUXURY_TAX) {
    game.stats.taxes += 100;
    ctx.owe(p, 100, "luxury tax");
    if (!p.bot) ctx.onLandFee?.("Luxury Tax", "You paid $100 luxury tax.");
    return;
  }
  if (i === FREE_PARKING) {
    if (game.settings.freeParking && game.pot) {
      ctx.gain(p, game.pot, "Free Parking jackpot");
      game.pot = 0;
    } else ctx.say(`${p.name} rests on Free Parking.`);
    return;
  }
  if (i === JAIL_INDEX) return;

  if (g[0] === "Community Fund") {
    runCard(game, p, cardForDiceTotal(game, "community", game.lastRoll), ctx, "community");
    return;
  }
  if (g[0] === "Chance") {
    runCard(game, p, cardForDiceTotal(game, "chance", game.lastRoll), ctx, "chance");
    return;
  }

  if (a.owner !== null && a.owner !== idx) {
    const amount = rentAmount(game, i);
    game.stats.rent += amount;
    if (amount) ctx.owe(p, amount, "rent to " + game.players[a.owner].name, a.owner);
    else ctx.say(`${BOARD[i][0]} is mortgaged — no rent due.`);
    return;
  }

  if (a.owner === null && g[2] > 0 && !game.auction) {
    if (p.bot) {
      ctx.botBuyDecision?.(p, i);
    } else {
      setPendingBuy(game, p, i);
      ctx.onPending?.();
    }
  }
}

export function resolveIncomeTax(game, p, usePercent, ctx) {
  const w = worth(game, p);
  const tax = usePercent ? Math.floor(w * 0.1) : 200;
  game.stats.taxes += tax;
  clearPending(game);
  ctx.owe(p, tax, usePercent ? "income tax (10%)" : "income tax ($200)");
}

export function resolveJailTurn(game, p, choice, ctx) {
  clearPending(game);
  if (choice === "card" && p.getOutCards > 0) {
    p.getOutCards--;
    p.jail = 0;
    p.jailTurns = 0;
    ctx.say(`${p.name} used a Get Out of Jail Free card.`);
    return "free";
  }
  if (choice === "pay") {
    if (ctx.owe(p, 50, "bail")) {
      p.jail = 0;
      p.jailTurns = 0;
      ctx.say(`${p.name} paid $50 bail.`);
      return "free";
    }
    return "bankrupt";
  }
  return "roll";
}

export function endTurn(game) {
  if (game.pending || game.auction || game.mustRollAgain) return false;
  if (!game.rolled) return false;
  game.rolled = false;
  game.players[game.turn].doublesInRow = 0;
  let next = game.turn;
  do {
    next = (next + 1) % 4;
    if (next === 0) game.round++;
  } while (game.players[next].bankrupt || game.players[next].inactive);
  game.turn = next;
  return true;
}

export function applyRoll(game, p, d1, d2, ctx) {
  game.lastDice = [d1, d2];
  const total = d1 + d2;
  game.lastRoll = total;
  game.stats.rolls++;

  if (p.jail) {
    if (d1 === d2) {
      p.jail = 0;
      p.jailTurns = 0;
      ctx.say(`${p.name} rolled doubles and left Jail.`);
    } else {
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        if (!ctx.owe(p, 50, "forced bail after 3 turns in Jail")) return { stuck: true, total: 0 };
        p.jail = 0;
        p.jailTurns = 0;
        ctx.say(`${p.name} paid $50 after three turns in Jail.`);
      } else {
        ctx.say(`${p.name} failed to roll doubles in Jail (turn ${p.jailTurns}/3).`);
        game.rolled = true;
        if (!p.bot) setPendingJail(game, p);
        return { stuck: true, total: 0 };
      }
    }
  }

  const isDouble = d1 === d2;
  if (isDouble) {
    p.doublesInRow++;
    if (p.doublesInRow >= 3) {
      trySendToJail(game, p, ctx, "third doubles");
      game.rolled = true;
      p.doublesInRow = 0;
      game.mustRollAgain = false;
      return { jail: true, total: 0 };
    }
    game.mustRollAgain = true;
  } else {
    p.doublesInRow = 0;
    game.mustRollAgain = false;
  }

  const goMoney = advancePosition(game, p, total);
  if (goMoney) ctx.gain(p, goMoney, "passing GO");

  return { total, isDouble, space: p.pos };
}

export function createGame(overrides) {
  const game = freshGame(overrides);
  initDecks(game);
  return game;
}

export { freshGame, BOARD, COLOR_GROUPS, groupOf };

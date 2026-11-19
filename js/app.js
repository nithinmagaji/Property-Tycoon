import {
  BOARD,
  spaceDisplayName,
  money,
  PURCHASE_DECISION_SECONDS,
  BOT_ROSTER,
  PLAYER_COLORS,
  AVATARS,
  DEFAULT_NAMES,
} from "./data.js";
import { auctionPropertyHTML, auctionBidStatusHTML, propertyDetailHTML } from "./board-info.js";
import { renderCenterDecks } from "./cards.js";
import {
  createGame,
  asset,
  worth,
  buyProperty,
  clearPending,
  landOnSpace,
  applyRoll,
  endTurn,
  resolveIncomeTax,
  resolveJailTurn,
  declareBankrupt,
  autoLiquidate,
  shouldDeclareBankrupt,
  buildHouse,
  sellBuilding,
  mortgageProperty,
  unmortgageProperty,
  mortgageValue,
  unmortgageCost,
  initDecks,
  sendToJail,
  reconcileOwnership,
  normalizeAssetStore,
  executePropertyTrade,
  checkMortgageForeclosures,
  minimumTradePrice,
  unmortgageCostForAsset,
  buildingSellValue,
} from "./engine.js";
import {
  botBuyOrAuction,
  botDevelop,
  botTradeEvaluate,
  botAuctionBidChance,
  pickBotPropertyTrade,
} from "./ai.js";
import {
  toast,
  modal,
  closeModal,
  renderBoard,
  renderPlayers,
  renderLog,
  renderDice,
  renderPurchasePanel,
  renderAuctionStatus,
  renderLockBanner,
  updateControlStates,
  financeReportHTML,
  manageModalHTML,
  animateMove,
  animateRentTransfer,
  setTheme,
  ensureBoardSprite,
  bindCenterDeckClicks,
  showCardDrawModal,
  $,
} from "./ui.js";
import { MultiplayerClient, attachMultiplayerMeta, clearMultiplayer } from "./multiplayer.js";
import {
  setSoundEnabled,
  isSoundOn,
  sfx,
  sfxRoll,
  sfxBuy,
  sfxBuild,
  startSoundtrack,
  stopSoundtrack,
  resumeSoundtrackIfEnabled,
} from "./audio.js";
import { COUNTRY_OPTIONS, applyCountryToBoard } from "./countries.js";
import { pushUndoState, canUndo, popUndoState } from "./history.js";
import { snapshotForPersist } from "./persist.js";
import { onRoundCompleted, unsoldPropertyIndices } from "./market.js";

let game = createGame();
let rolling = false;
/** Ephemeral — never persisted in save blob */
let cardRevealQueue = [];
let landingNoticeQueue = [];
let mp = null;
let turnTimerId = null;
let turnDeadline = 0;
let auctionBidTimerId = null;
let auctionBidDeadline = 0;
let purchaseTimerId = null;
let purchaseDeadline = 0;
let purchaseTimerPass = null;
const AUCTION_BID_SECONDS = 30;

function activeSeat() {
  if (game.settings?.hotseat) return game.turn;
  return game.multiplayer?.localSeat ?? 0;
}

function snapshotBeforeHumanAction() {
  const p = game.players[game.turn];
  if (p && !p.bot) pushUndoState(game);
}

function togglePause() {
  if (game.done) return;
  game.paused = !game.paused;
  if (game.paused) {
    if (turnTimerId) clearInterval(turnTimerId);
    turnTimerId = null;
    clearPurchaseTimer();
    clearAuctionBidTimer();
    clearAuctionTimer();
    say("Game paused.");
  } else {
    say("Game resumed.");
    resumeTurnAfterPause();
  }
  autoSave();
  renderAll();
}

function clearPurchaseTimer() {
  if (purchaseTimerId) clearInterval(purchaseTimerId);
  purchaseTimerId = null;
  purchaseTimerPass = null;
  purchaseDeadline = 0;
}

function resetPurchaseDecisionTimer(handlers) {
  const pending = game.pending;
  if (!pending || pending.type !== "buy" || game.paused || game.done) {
    clearPurchaseTimer();
    return;
  }
  const buyer = game.players[pending.player];
  if (buyer.bot) {
    clearPurchaseTimer();
    return;
  }
  const i = pending.space;
  // Keep existing countdown if still deciding the same space.
  if (purchaseTimerId && purchaseDeadline > Date.now()) {
    purchaseTimerPass = () => handlers.onPass(i);
    const el = $("purchaseTimer");
    if (el) {
      const left = Math.max(0, Math.ceil((purchaseDeadline - Date.now()) / 1000));
      el.textContent = left > 0 ? `Decide in ${left}s (otherwise auto-pass)` : "";
    }
    return;
  }
  clearPurchaseTimer();
  purchaseTimerPass = () => handlers.onPass(i);
  purchaseDeadline = Date.now() + PURCHASE_DECISION_SECONDS * 1000;
  purchaseTimerId = setInterval(() => {
    if (game.pending?.type !== "buy" || game.pending?.space !== i) {
      clearPurchaseTimer();
      return;
    }
    const el = $("purchaseTimer");
    const left = Math.max(0, Math.ceil((purchaseDeadline - Date.now()) / 1000));
    if (el) el.textContent = left > 0 ? `Decide in ${left}s (otherwise auto-pass)` : "";
    if (left <= 0) {
      clearPurchaseTimer();
      toast("Time's up — passed on property.");
      purchaseTimerPass?.();
    }
  }, 300);
}

function resetTurnTimer() {
  if (turnTimerId) clearInterval(turnTimerId);
  turnTimerId = null;
  const el = $("turnTimer");
  if (!el) return;
  const p = game.players[game.turn];
  if (game.done || game.paused || p.bot || game.auction) {
    el.textContent = "";
    return;
  }
  const sec = game.settings.turnSeconds ?? 60;
  turnDeadline = Date.now() + sec * 1000;
  turnTimerId = setInterval(() => {
    const left = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
    el.textContent = `Time left: ${left}s`;
    if (left <= 0) {
      clearInterval(turnTimerId);
      turnTimerId = null;
      toast(`${p.name}'s turn timed out (60s).`);
      if (!p.bot) {
        game.rolled = true;
        endTurnClick();
      }
    }
  }, 400);
}

function syncPlayerNamesToSettings() {
  game.settings.playerNames = game.players.map((p) => p.name);
}

function restorePlayerNameFocus() {
  const inp = document.activeElement;
  if (!inp?.classList?.contains("player-name-input")) return;
  const seat = inp.dataset.seat;
  const val = inp.value;
  const sel = inp.selectionStart;
  requestAnimationFrame(() => {
    const next = document.querySelector(`.player-name-input[data-seat="${seat}"]`);
    if (!next) return;
    next.value = val;
    next.focus();
    if (typeof sel === "number" && typeof next.setSelectionRange === "function") {
      next.setSelectionRange(sel, sel);
    }
  });
}

function tradeProposalBody(buyer, seller, prop, price) {
  const propName = BOARD[prop][0];
  const facts = propertyDetailHTML(prop, true);
  const a = asset(game, prop);
  const min = minimumTradePrice(game, prop);
  const mortgagedNote = a.mortgaged
    ? `<p class="small warn-trade">⚠️ <b>Mortgaged</b> — bank takes <b>$${unmortgageCostForAsset(a, prop)}</b> from the sale (principal + 5%), then the seller gets the remainder.</p>`
    : "";
  const list = seller.props.includes(prop)
    ? `<p class="small">Minimum offer: <b>$${min}</b> · Seller cash after: <b>$${seller.cash + Math.max(0, money(price - (a.mortgaged ? unmortgageCostForAsset(a, prop) : 0)))}</b> · Buyer cash after: <b>$${buyer.cash - price}</b></p>`
    : "";
  if (!seller.bot) {
    return `<p><b>${buyer.name}</b> wants to buy <b>${propName}</b> from you for <b>$${price}</b>.</p>${facts}${mortgagedNote}${list}<p class="small">Accept to sell this property.</p>`;
  }
  if (!buyer.bot) {
    return `<p><b>${seller.name}</b> offers <b>${propName}</b> to you for <b>$${price}</b>.</p>${facts}${mortgagedNote}${list}<p class="small">Accept to buy this property.</p>`;
  }
  return `<p><b>${buyer.name}</b> buys <b>${propName}</b> from <b>${seller.name}</b> for <b>$${price}</b>.</p>${facts}${mortgagedNote}`;
}

function showTradeCompletedModal(buyer, seller, prop, price) {
  modal(
    "Trade completed",
    `<p><b>${buyer.name}</b> bought <b>${BOARD[prop][0]}</b> from <b>${seller.name}</b> for <b>$${price}</b>.</p>`,
    [{ label: "OK", cls: "primary", fn: () => renderAll() }]
  );
}

function tryBotTradeEvent() {
  const offer = pickBotPropertyTrade(game);
  if (!offer) return;
  const { buyer, seller, prop, price } = offer;
  const humanInvolved = !buyer.bot || !seller.bot;

  const finish = (accepted) => {
    if (accepted && executePropertyTrade(game, buyer, seller, prop, price, say)) {
      if (humanInvolved) showTradeCompletedModal(buyer, seller, prop, price);
      else toast(`🤝 ${buyer.name} traded with ${seller.name}`);
    } else if (!accepted) {
      say(`${buyer.name}'s trade offer for ${BOARD[prop][0]} was declined.`);
    }
    renderAll();
    autoSave();
  };

  if (!humanInvolved) {
    finish(true);
    return;
  }

  modal(
    "Trade offer",
    tradeProposalBody(buyer, seller, prop, price),
    [
      {
        label: "Accept",
        cls: "primary",
        fn: () => finish(true),
      },
      {
        label: "Decline",
        fn: () => finish(false),
      },
    ]
  );
}

function triggerBankAuctionIfStale() {
  const stale = onRoundCompleted(game);
  if (stale < 2) return;
  const pool = unsoldPropertyIndices(game);
  if (!pool.length) return;
  game.market.staleRounds = 0;
  const i = pool[Math.floor(Math.random() * pool.length)];
  say(`🏦 Bank auction — no purchases for 2 rounds. Bidding on ${BOARD[i][0]}.`);
  startAuction(i, null);
}

function syncPlayerNamesFromSettings() {
  const names = game.settings?.playerNames;
  if (names?.length === 4) {
    game.players.forEach((p, i) => {
      if (names[i]) p.name = names[i];
    });
  } else {
    syncPlayerNamesToSettings();
  }
}

function syncBotFlagsOnly() {
  const count = game.settings?.playerCount ?? 4;
  game.players.forEach((p, i) => {
    if (i >= count) p.inactive = true;
  });
  if (game.settings?.hotseat) {
    game.players.forEach((p, i) => {
      if (!p.inactive) p.bot = false;
    });
    return;
  }
  const seat = game.multiplayer?.localSeat ?? 0;
  game.players.forEach((p, i) => {
    if (!p.inactive) p.bot = i !== seat;
  });
}

function configurePlayersForMode() {
  const saved = game.settings.playerNames;
  if (game.settings.hotseat) {
    game.players.forEach((p, i) => {
      p.bot = false;
      p.name =
        saved?.[i] ??
        (i === 0 ? "Player 1" : BOT_ROSTER[i - 1]?.name ?? `Player ${i + 1}`);
      if (i > 0 && BOT_ROSTER[i - 1]) {
        p.personality = BOT_ROSTER[i - 1].personality;
        p.avatar = BOT_ROSTER[i - 1].avatar;
      }
    });
    syncPlayerNamesToSettings();
    game.settings.countryLocked = true;
    return;
  }
  game.players[0].bot = false;
  game.players[0].name = saved?.[0] ?? "Player 1";
  BOT_ROSTER.forEach((b, idx) => {
    const p = game.players[idx + 1];
    if (!p) return;
    p.name = saved?.[idx + 1] ?? b.name;
    p.personality = b.personality;
    p.avatar = b.avatar;
    p.bot = true;
  });
  syncPlayerNamesToSettings();
  game.settings.countryLocked = true;
}

/** Bot pacing — mirrors human dice shake, token walk, and time to read the board. */
const BOT_PACE = {
  turnStart: 1000,
  beforeRoll: 800,
  beforeLand: 600,
  afterLand: 1300,
  beforeBuild: 700,
  beforeEndTurn: 900,
  betweenDoubles: 850,
  resume: 750,
};

const DICE_SHAKE_FRAMES = 8;
const DICE_SHAKE_MS = 65;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function animateDiceRoll() {
  stopSoundtrack();
  sfxRoll();
  if (game._skipAnimations) {
    const d1 = 1 + ((Math.random() * 6) | 0);
    const d2 = 1 + ((Math.random() * 6) | 0);
    return { d1, d2 };
  }
  renderDice(1, 1, true);
  for (let n = 0; n < DICE_SHAKE_FRAMES; n++) {
    if (game._skipAnimations) break;
    await wait(DICE_SHAKE_MS);
    const r1 = 1 + ((Math.random() * 6) | 0);
    const r2 = 1 + ((Math.random() * 6) | 0);
    renderDice(r1, r2, true);
  }
  const d1 = 1 + ((Math.random() * 6) | 0);
  const d2 = 1 + ((Math.random() * 6) | 0);
  game._skipAnimations = false;
  return { d1, d2 };
}

function scheduleBotPlay(delay = BOT_PACE.turnStart) {
  setTimeout(() => {
    if (!game.paused) void botPlay();
  }, delay);
}

function scheduleBotPostRoll(delay = BOT_PACE.afterLand) {
  setTimeout(() => {
    if (!game.paused) void botPostRoll();
  }, delay);
}

function say(s) {
  game.log.unshift(s);
  game.log = game.log.slice(0, 80);
  renderLog(game);
  autoSave();
  syncMultiplayer("log");
}

let saveDebounceId = null;

function autoSaveNow() {
  if (saveDebounceId) {
    clearTimeout(saveDebounceId);
    saveDebounceId = null;
  }
  try {
    const blob = JSON.stringify(snapshotForPersist(game));
    localStorage.setItem("propertyTycoonAdvanced", blob);
  } catch (err) {
    if (game.undoStack?.length > 4) {
      game.undoStack = game.undoStack.slice(-4);
      try {
        localStorage.setItem("propertyTycoonAdvanced", JSON.stringify(snapshotForPersist(game)));
      } catch {
        /* quota */
      }
    }
  }
}

function autoSave() {
  if (saveDebounceId) clearTimeout(saveDebounceId);
  saveDebounceId = setTimeout(() => {
    saveDebounceId = null;
    autoSaveNow();
  }, 250);
}

function syncMultiplayer(action) {
  if (game.multiplayer?.isHost && mp?.connected) {
    mp.syncState(game, action);
  }
}

function releasePlayLocks() {
  rolling = false;
  game.animating = false;
}

function queueCardReveal(card, deckKey) {
  cardRevealQueue.push({ card, deckKey });
}

function queueLandingNotice(title, body) {
  landingNoticeQueue.push({ title, body });
}

/** Cards, taxes, and fees — after move locks release (prevents frozen UI). */
async function flushLandingFlow() {
  const p = game.players[game.turn];
  if (cardRevealQueue.length) {
    const queue = cardRevealQueue;
    cardRevealQueue = [];
    renderCenterDecks(game);
    for (let i = 0; i < queue.length; i++) {
      const { card, deckKey } = queue[i];
      const deckLabel = deckKey === "chance" ? "Chance" : "Community Fund";
      const accent = deckKey === "chance" ? "#e8a735" : "#5cb8d6";
      if (!p.bot) {
        await new Promise((resolve) => {
          showCardDrawModal(deckLabel, card, accent, resolve);
        });
      } else {
        toast(`${deckLabel}: ${card.t}`);
        await wait(350);
      }
    }
  }
  if (landingNoticeQueue.length) {
    const notices = landingNoticeQueue;
    landingNoticeQueue = [];
    for (const { title, body } of notices) {
      if (!p.bot) {
        await new Promise((resolve) => {
          modal(title, `<p>${body}</p>`, [{ label: "OK", cls: "primary", fn: () => resolve() }]);
        });
      } else {
        toast(`${title}: ${body}`);
      }
    }
  }
  releasePlayLocks();
  renderAll();
}

function gain(p, n, why) {
  n = money(n);
  p.cash = money(p.cash + n);
  say(`${p.name} received $${n} — ${why}.`);
  sfx(660);
}

function owe(p, n, why, receiver = null) {
  n = money(Math.max(0, n));
  if (p.cash < n) {
    autoLiquidate(game, p, n, say);
    if (shouldDeclareBankrupt(game, p, n)) {
      declareBankrupt(game, p, receiver, say);
      onGameOverMaybe();
      renderAll();
      return false;
    }
    if (p.cash < n) {
      say(
        `${p.name} still needs $${n - p.cash} — mortgage properties in Manage assets or raise cash before paying.`
      );
      renderAll();
      return false;
    }
  }
  p.cash = money(p.cash - n);
  if (receiver !== null) game.players[receiver].cash = money(game.players[receiver].cash + n);
  if (game.settings.freeParking && !receiver && (why.includes("tax") || why.includes("fine"))) {
    game.pot += n;
  }
  say(`${p.name} paid $${n} — ${why}.`);
  sfx(180);
  if (receiver !== null && p.bot && game.settings.animations && /rent/i.test(why)) {
    const payerIdx = game.players.indexOf(p);
    if (payerIdx >= 0) {
      game._rentFx = { fromSpace: p.pos, payer: payerIdx, receiver, amount: n };
    }
  }
  return true;
}

const landCtx = () => ({
  say,
  gain,
  owe,
  land: (p) => afterLand(p, true),
  onCardDraw: (card, deckKey) => queueCardReveal(card, deckKey),
  onLandFee: (title, body) => queueLandingNotice(title, body),
  onPending: () => {
    /* Panel is drawn after completeMove releases roll/animation locks */
  },
  botBuyDecision: (p, i) => {
    botBuyOrAuction(game, p, i, say, startAuction);
  },
});

function afterLand(p, deferRender = false) {
  landOnSpace(game, p, landCtx());
  if (!deferRender) {
    releasePlayLocks();
    renderAll();
  }
  if (game._rentFx) {
    const fx = game._rentFx;
    game._rentFx = null;
    const payer = game.players[fx.payer];
    const recv = game.players[fx.receiver];
    animateRentTransfer(
      fx.fromSpace,
      fx.payer,
      fx.receiver,
      fx.amount,
      payer?.color,
      recv?.color
    );
  }
}

function onGameOverMaybe() {
  if (game.done) {
    const w = game.players.find((x) => !x.bankrupt && !x.inactive);
    modal("🏆 " + w.name + " wins!", `Final net worth: $${worth(game, w)}.`, [
      { label: "New game", cls: "primary", fn: newGame },
    ]);
  }
}

function clearAuctionTimer() {
  if (game._auctionTimer) {
    clearTimeout(game._auctionTimer);
    game._auctionTimer = null;
  }
}

function clearAuctionBidTimer() {
  if (auctionBidTimerId) {
    clearInterval(auctionBidTimerId);
    auctionBidTimerId = null;
  }
}

function startAuctionBidTimer(seat) {
  clearAuctionBidTimer();
  auctionBidDeadline = Date.now() + AUCTION_BID_SECONDS * 1000;
  const tick = () => {
    const el = document.getElementById("auctionBidTimer");
    const left = Math.max(0, Math.ceil((auctionBidDeadline - Date.now()) / 1000));
    if (el) el.textContent = left > 0 ? `Time to bid: ${left}s` : "Time's up — auto pass";
    if (left <= 0) {
      clearAuctionBidTimer();
      const a = game.auction;
      if (!a || a.current !== seat) return;
      if (!a.passed.includes(seat)) {
        a.passed.push(seat);
        say(`${game.players[seat].name} timed out in the auction (30s).`);
      }
      nextAuction();
    }
  };
  tick();
  auctionBidTimerId = setInterval(tick, 400);
}

function scheduleAuctionStep(delay = 500) {
  clearAuctionTimer();
  game._auctionTimer = setTimeout(() => {
    game._auctionTimer = null;
    if (game.auction && !game.paused) auctionStep();
  }, delay);
}

/** Auction ends when everyone else has passed or no one can bid. */
function auctionShouldFinish(a) {
  const alive = a.eligible.filter((i) => !a.passed.includes(i));
  if (!alive.length) return true;
  if (a.leader !== null) {
    const others = a.eligible.filter((i) => i !== a.leader);
    if (others.length && others.every((i) => a.passed.includes(i))) return true;
  }
  return false;
}

function syncFlowState() {
  if (!rolling) game.animating = false;
  const localSeat = game.multiplayer?.localSeat ?? 0;
  if (!game.auction || game.done) return;
  const a = game.auction;
  const cur = game.players[a.current];
  const modalOpen = $("modalbg")?.classList.contains("show");
  if (!cur.bot && a.current === localSeat && !modalOpen) {
    const holdHigh = a.leader === localSeat && a.bid > 0;
    if (!holdHigh && !game._auctionTimer) scheduleAuctionStep(250);
  }
}

function firstBidderAfter(declinedBy, eligibleIds) {
  if (declinedBy === null || declinedBy === undefined) return eligibleIds[0];
  for (let k = 1; k <= 4; k++) {
    const j = (declinedBy + k) % 4;
    if (eligibleIds.includes(j)) return j;
  }
  return eligibleIds[0];
}

function startPlayerBankAuction(spaceIndex, sellerSeat) {
  if (game.auction || game.done) return;
  const seller = game.players[sellerSeat];
  const a = asset(game, spaceIndex);
  if (a.owner !== sellerSeat || a.mortgaged || a.houses) {
    toast("Sell all buildings and unmortgage before a bank auction.");
    return;
  }
  const eligible = game.players
    .map((p, j) => ({ p, j }))
    .filter(
      (x) => !x.p.bankrupt && !x.p.inactive && x.j !== sellerSeat && x.p.cash >= 1
    )
    .map((x) => x.j);
  if (eligible.length < 1) {
    toast("No bidders available.");
    return;
  }
  clearAuctionTimer();
  game.auction = {
    space: spaceIndex,
    bid: 0,
    leader: null,
    turns: 0,
    eligible,
    current: eligible[0],
    passed: [],
    bankMediated: true,
    seller: sellerSeat,
  };
  say(`🏦 ${seller.name} listed ${BOARD[spaceIndex][0]} for bank auction (25% fee).`);
  closeModal();
  auctionStep();
}

function startAuction(i, declinedBy = null) {
  if (!game.settings.auction) {
    say("Auctions are disabled.");
    clearPending(game);
    renderAll();
    return;
  }
  const eligible = game.players
    .map((p, j) => ({ p, j }))
    .filter((x) => !x.p.bankrupt && !x.p.inactive && x.p.cash >= 1);
  if (!eligible.length) {
    clearPending(game);
    renderAll();
    return;
  }
  const ids = eligible.map((x) => x.j);
  const opener = declinedBy ?? game.turn;
  clearAuctionTimer();
  game.auction = {
    space: i,
    bid: 0,
    leader: null,
    turns: 0,
    eligible: ids,
    current: firstBidderAfter(opener, ids),
    passed: [],
    declinedBy: opener,
  };
  auctionStep();
}

function auctionStep() {
  const a = game.auction;
  if (!a) return;
  if (auctionShouldFinish(a)) {
    finishAuction();
    return;
  }
  const p = game.players[a.current];
  const localSeat = activeSeat();
  if (p.bot || a.current !== localSeat) {
    clearAuctionBidTimer();
    const max = Math.min(
      p.cash,
      Math.floor(BOARD[a.space][2] * (p.personality === "builder" ? 1.15 : p.personality === "trader" ? 0.85 : 1))
    );
    const bid = a.bid + 1;
    const floor = a.bankMediated
      ? Math.floor(BOARD[a.space][2] * 0.2)
      : Math.floor(BOARD[a.space][2] * 0.35);
    if (max > a.bid && max >= floor && botAuctionBidChance(game, p, a)) {
      a.bid = Math.min(
        max,
        Math.max(bid, Math.floor(a.bid + BOARD[a.space][2] * (a.bankMediated ? 0.22 : 0.28)))
      );
      a.leader = a.current;
      say(`${p.name} bids $${a.bid} for ${BOARD[a.space][0]}.`);
    } else {
      a.passed.push(a.current);
      say(`${p.name} passes in the auction.`);
    }
    renderAuctionStatus(game);
    nextAuction();
  } else if (a.leader === localSeat && a.bid > 0 && a.current === localSeat) {
    renderAuctionStatus(game);
    nextAuction();
  } else {
    renderAuctionStatus(game);
    closeModal();
    const feeNote = a.bankMediated
      ? `<p class="small">Bank-mediated sale — seller receives 75% of winning bid.</p>`
      : "";
    modal(
      "Auction: " + BOARD[a.space][0],
      `${auctionPropertyHTML(a.space)}
      ${auctionBidStatusHTML(game)}
      ${feeNote}
      <p id="auctionBidTimer" class="turn-timer" aria-live="polite"></p>
      <p class="small">Your cash: <b>$${p.cash}</b></p>
      <label>Your bid (must exceed current)</label>
      <input id="bidInput" type="number" min="${a.bid + 1}" max="${p.cash}" value="${Math.min(p.cash, a.bid + 10)}">`,
      [
        {
          label: "Place bid",
          cls: "primary",
          fn: () => {
            clearAuctionBidTimer();
            const v = Number($("bidInput")?.value);
            if (v > a.bid && v <= p.cash) {
              a.bid = v;
              a.leader = localSeat;
              say(`You bid $${v} for ${BOARD[a.space][0]}.`);
            } else toast("Invalid bid");
            nextAuction();
          },
        },
        {
          label: "Pass",
          fn: () => {
            clearAuctionBidTimer();
            a.passed.push(localSeat);
            say("You passed in the auction.");
            nextAuction();
          },
        },
      ]
    );
    startAuctionBidTimer(localSeat);
  }
}

function nextAuction() {
  const a = game.auction;
  if (!a) return;
  clearAuctionBidTimer();
  closeModal();
  if (auctionShouldFinish(a)) {
    finishAuction();
    return;
  }
  const alive = a.eligible.filter((i) => !a.passed.includes(i));
  if (!alive.length) {
    finishAuction();
    return;
  }
  const order = a.eligible;
  let pos = order.indexOf(a.current);
  if (pos < 0) pos = 0;
  let found = false;
  for (let k = 1; k <= order.length; k++) {
    const j = order[(pos + k) % order.length];
    if (alive.includes(j)) {
      a.current = j;
      found = true;
      break;
    }
  }
  if (!found) {
    finishAuction();
    return;
  }
  a.turns++;
  if (a.turns > 32) {
    finishAuction();
    return;
  }
  scheduleAuctionStep(500);
}

function finishAuction() {
  const a = game.auction;
  if (!a) return;
  clearAuctionTimer();
  clearAuctionBidTimer();
  closeModal();
  if (a.leader !== null) {
    const p = game.players[a.leader];
    if (p.cash >= a.bid) {
      p.cash -= a.bid;
      if (a.bankMediated && a.seller != null) {
        const seller = game.players[a.seller];
        const sellerShare = Math.floor(a.bid * 0.75);
        const bankFee = a.bid - sellerShare;
        seller.cash += sellerShare;
        seller.props = seller.props.filter((i) => i !== a.space);
        p.props.push(a.space);
        asset(game, a.space).owner = a.leader;
        game.stats.auctions++;
        game.stats.taxes += bankFee;
        say(
          `${p.name} won ${BOARD[a.space][0]} at bank auction for $${a.bid}. ${seller.name} received $${sellerShare} (bank fee $${bankFee}).`
        );
      } else {
        p.props.push(a.space);
        asset(game, a.space).owner = a.leader;
        game.stats.auctions++;
        say(`${p.name} won ${BOARD[a.space][0]} at auction for $${a.bid}.`);
      }
    }
  } else say(`${BOARD[a.space][0]} received no bids.`);
  game.auction = null;
  reconcileOwnership(game);
  renderAll();
  autoSaveNow();
  syncMultiplayer("auction");
  resumeTurnAfterPause();
}

/** After a resolved land/buy/auction, humans auto-pass the turn (no End Turn click). */
function maybeAutoEndHumanTurn() {
  const p = game.players[game.turn];
  if (
    !p ||
    p.bot ||
    game.done ||
    game.paused ||
    game.pending ||
    game.auction ||
    game.mustRollAgain ||
    !game.rolled
  ) {
    return;
  }
  endTurnClick();
}

/** Continue turn flow after auction or other async pause (fixes AI turn stuck). */
function resumeTurnAfterPause() {
  releasePlayLocks();
  if (game.done || game.auction) return;
  const p = game.players[game.turn];
  if (game.pending) {
    renderAll();
    return;
  }
  if (p.bot) {
    if (!game.rolled) scheduleBotPlay(BOT_PACE.resume);
    else scheduleBotPostRoll(BOT_PACE.resume);
  } else {
    renderAll();
    maybeAutoEndHumanTurn();
  }
}

function resumeGameAfterLoad() {
  const cur = game.players[game.turn];
  if (game.paused) return;
  if (game.auction) {
    scheduleAuctionStep(600);
    return;
  }
  if (cur?.inactive || cur?.bankrupt) {
    endTurnClick();
    return;
  }
  if (cur.bot && !game.rolled && !game.pending) scheduleBotPlay(BOT_PACE.resume);
  else if (cur.bot && game.rolled && !game.pending) scheduleBotPostRoll(BOT_PACE.resume);
  else if (!cur.bot && game.rolled && !game.pending && !game.mustRollAgain) {
    releasePlayLocks();
    renderAll();
    maybeAutoEndHumanTurn();
  }
}

const purchaseHandlers = {
  onBuy(i) {
    clearPurchaseTimer();
    const seat = game.pending?.player ?? activeSeat();
    if (seat === activeSeat()) snapshotBeforeHumanAction();
    const p = game.players[seat];
    if (buyProperty(game, p, i, say)) {
      sfxBuy();
      clearPending(game);
      renderAll();
      syncMultiplayer("buy");
      resumeTurnAfterPause();
    }
  },
  onAuction(i) {
    clearPurchaseTimer();
    const opener = game.pending?.player ?? game.turn;
    clearPending(game);
    renderAll();
    startAuction(i, opener);
  },
  onPass(i) {
    clearPurchaseTimer();
    const who = game.pending?.player ?? game.turn;
    say(`${game.players[who].name} passed on ${BOARD[i ?? game.pending?.space ?? 0][0]}.`);
    clearPending(game);
    renderAll();
    syncMultiplayer("pass");
    resumeTurnAfterPause();
  },
  onTax(usePercent) {
    if (game.pending?.type !== "incomeTax") return;
    const p = game.players[game.pending.player];
    resolveIncomeTax(game, p, usePercent, { owe });
    releasePlayLocks();
    syncMultiplayer("tax");
    autoSave();
    resumeTurnAfterPause();
  },
  onJail(choice) {
    const p = game.players[game.pending.player];
    resolveJailTurn(game, p, choice, { say, owe });
    clearPending(game);
    renderAll();
    syncMultiplayer("jail");
    resumeTurnAfterPause();
  },
  onJailFreeChoice(useCard) {
    const seat = game.pending?.player ?? game.turn;
    const p = game.players[seat];
    clearPending(game);
    if (useCard && p.getOutCards) {
      p.getOutCards--;
      say(`${p.name} used a Get Out of Jail Free card instead of going to Jail.`);
    } else {
      sendToJail(game, p, say);
    }
    renderAll();
    resumeTurnAfterPause();
  },
};

async function completeMove(p, d1, d2, total, fromPos) {
  try {
    const destPos = p.pos;
    renderDice(d1, d2, false, total);
    const steps = (destPos - fromPos + 40) % 40;
    if (steps && game.settings.animations) {
      await animateMove(game, p, fromPos, steps, renderLockBanner.bind(null, game));
      renderLockBanner(game);
    }
    p.pos = destPos;
    say(`${p.name} rolled ${d1}+${d2}=${total}, landing on ${BOARD[p.pos][0]}.`);
    game.rolled = !game.mustRollAgain;
    if (p.bot) await wait(BOT_PACE.beforeLand);
    afterLand(p, true);
  } finally {
    releasePlayLocks();
  }
  renderAll();
  try {
    await flushLandingFlow();
  } catch (err) {
    console.error(err);
    releasePlayLocks();
    cardRevealQueue = [];
    landingNoticeQueue = [];
    toast("Event display error — you can continue.");
    renderAll();
  }
  autoSaveNow();
  if (game.auction) return;
  if (p.bot) scheduleBotPostRoll();
  else if (game.mustRollAgain) {
    toast("Doubles! Roll again.");
    game.rolled = false;
    renderAll();
  } else if (game.pending) {
    renderAll();
  } else {
    maybeAutoEndHumanTurn();
  }
}

async function roll() {
  if (rolling || game.done || game.paused) return;
  const localSeat = activeSeat();
  const p = game.players[game.turn];
  if (game.turn !== localSeat || p.bot) return;
  snapshotBeforeHumanAction();
  if (game.rolled && !game.mustRollAgain) return;
  if (game.pending || game.auction) return;

  rolling = true;
  const fromPos = p.pos;
  (async () => {
    try {
      const { d1, d2 } = await animateDiceRoll();
      const result = applyRoll(game, p, d1, d2, { say, gain, owe, land: () => {} });
      if (result.stuck || result.jail) {
        renderDice(d1, d2, false, game.lastRoll);
        game.rolled = true;
        if (result.jail) afterLand(p);
        autoSave();
        syncMultiplayer("roll");
        resumeTurnAfterPause();
        return;
      }
      await completeMove(p, d1, d2, result.total, fromPos);
      syncMultiplayer("roll");
    } catch (err) {
      console.error(err);
      toast("Roll failed — try again.");
      game.rolled = false;
    } finally {
      releasePlayLocks();
      renderAll();
    }
  })();
}

async function botPlay() {
  if (game.done || game.paused) return;
  const p = game.players[game.turn];
  if (!p.bot || game.pending || game.auction) return;
  if (game.rolled && !game.mustRollAgain) {
    await wait(BOT_PACE.beforeBuild);
    botDevelop(game, p, say);
    renderAll();
    await wait(BOT_PACE.beforeEndTurn);
    endTurnClick();
    return;
  }
  if (game.rolled && game.mustRollAgain) {
    /* roll again */
  } else if (game.rolled) return;
  if (rolling) return;

  rolling = true;
  const fromPos = p.pos;
  try {
    await wait(BOT_PACE.beforeRoll);
    const { d1, d2 } = await animateDiceRoll();
    const result = applyRoll(game, p, d1, d2, { say, gain, owe, land: () => {} });
    if (result.stuck || result.jail) {
      renderDice(d1, d2, false, game.lastRoll);
      game.rolled = true;
      if (result.jail) afterLand(p);
      renderAll();
      autoSave();
      syncMultiplayer("roll");
      if (game.auction) return;
      if (result.stuck) {
        await wait(BOT_PACE.beforeEndTurn);
        endTurnClick();
      } else scheduleBotPostRoll();
      return;
    }
    await completeMove(p, d1, d2, result.total, fromPos);
    syncMultiplayer("roll");
    autoSave();
  } finally {
    releasePlayLocks();
    renderAll();
  }
}

async function botPostRoll() {
  releasePlayLocks();
  if (game.done || game.pending || game.auction) return;
  const p = game.players[game.turn];
  if (rolling) {
    await wait(120);
    releasePlayLocks();
  }
  await wait(BOT_PACE.beforeBuild);
  if (p.bot) botDevelop(game, p, say);
  renderAll();
  if (game.pending || game.auction) return;
  if (game.mustRollAgain && p.bot) {
    toast(`${p.name} rolled doubles — rolling again…`);
    await wait(BOT_PACE.betweenDoubles);
    void botPlay();
  } else {
    await wait(BOT_PACE.beforeEndTurn);
    endTurnClick();
  }
}

function endTurnClick() {
  if (game.pending || game.auction || game.mustRollAgain) return;
  rolling = false;
  game.animating = false;
  const prevTurn = game.turn;
  if (!endTurn(game)) return;
  if (game.turn === 0 && prevTurn !== 0) {
    triggerBankAuctionIfStale();
    checkMortgageForeclosures(game, startAuction, say);
  }
  tryBotTradeEvent();
  renderAll();
  autoSave();
  syncMultiplayer("end");
  const next = game.players[game.turn];
  if (next.bot) scheduleBotPlay();
}

function renderAll() {
  const showRoll =
    game.lastRoll != null && (game.rolled || game.stats.rolls > 0) ? game.lastRoll : null;
  renderDice(game.lastDice?.[0] || 1, game.lastDice?.[1] || 1, false, showRoll);
  renderBoard(game, game.pending?.space);
  renderPlayers(game);
  restorePlayerNameFocus();
  const seat = game.multiplayer?.localSeat ?? 0;
  renderPurchasePanel(game, purchaseHandlers);
  resetPurchaseDecisionTimer(purchaseHandlers);
  renderAuctionStatus(game);
  renderLockBanner(game);
  updateControlStates(game, rolling);
  setTheme(game.settings.theme);
  syncFlowState();
  resetTurnTimer();
  const undoBtn = $("undoBtn");
  if (undoBtn) undoBtn.disabled = !canUndo(game, activeSeat(), { rolling });
}

function wireManagePropertyHandlers(mb, seat, { onRefresh } = {}) {
  const p = game.players[seat];
  mb.querySelectorAll("[data-mort]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.mort;
      if (asset(game, i).houses) {
        toast("Sell buildings first");
        return;
      }
      snapshotBeforeHumanAction();
      if (!mortgageProperty(game, p, i, say)) {
        toast("Cannot mortgage this property");
        return;
      }
      sfx(660);
      renderAll();
      autoSave();
      onRefresh ? onRefresh() : closeModal();
    };
  });
  mb.querySelectorAll("[data-unmort]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.unmort;
      const c = unmortgageCost(i);
      if (p.cash < c) {
        toast(`Need $${c} to unmortgage (you have $${p.cash})`);
        return;
      }
      snapshotBeforeHumanAction();
      if (!unmortgageProperty(game, p, i, say)) {
        toast("Cannot unmortgage");
        return;
      }
      sfx(180);
      renderAll();
      autoSave();
      onRefresh ? onRefresh() : closeModal();
    };
  });
}

function manage() {
  const seat = activeSeat();
  const p = game.players[seat];
  const rowCount = Math.max(p.props.length, 1);
  const rowsHtml =
    p.props.length > 0
      ? manageModalHTML(game, seat)
      : `<p class="small">No properties yet — buy or win at auction first.</p>`;
  modal(
    "Asset management",
    `<p>Cash <b>$${p.cash}</b> · <b>${p.props.length}</b> propert${p.props.length === 1 ? "y" : "ies"}</p>
    <div class="propertyrows">${rowsHtml}</div>
    <p class="small">Mortgage = <b>85%</b> of list price (sell houses/hotel to bank first at <b>75%</b>). Unmortgage = mortgage + <b>5%</b>. Building rent: 25% / 35% / 45% / 55% of price. Mortgaged 5 rounds → bank auction. Build on any owned site (4 houses → hotel).</p>`,
    [{ label: "Close", cls: "primary", fn: () => {} }],
    {
      modalClass: "modal-manage",
      cssVars: { "--manage-rows": String(rowCount) },
    }
  );
  const mb = $("mb");
  wireManagePropertyHandlers(mb, seat, { onRefresh: () => manage() });
  mb.querySelectorAll("[data-build]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.build;
      if (buildHouse(game, p, i, say)) {
        sfxBuild();
        const cell = document.querySelector(`[data-space="${i}"]`);
        cell?.classList.add("build-fx");
        renderAll();
        autoSave();
        closeModal();
        manage();
      } else toast("Cannot build here");
    };
  });
  mb.querySelectorAll("[data-sell]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.sell;
      if (sellBuilding(game, p, i, say)) {
        renderAll();
        autoSave();
        closeModal();
        manage();
      }
    };
  });
  mb.querySelectorAll("[data-bankauction]").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.bankauction;
      if (!confirm(`List ${BOARD[i][0]} for bank auction? You receive 75% of the winning bid.`)) return;
      startPlayerBankAuction(i, seat);
    };
  });
}

function trade() {
  const seat = activeSeat();
  const p = game.players[seat];
  const partners = game.players
    .map((x, i) => ({ x, i }))
    .filter((z) => z.i !== seat && !z.x.bankrupt);
  if (!partners.length) {
    toast("No trading partners");
    return;
  }
  const opt = partners
    .map((z) => {
      const active = z.x.props.filter((i) => !asset(game, i).mortgaged).length;
      const mtg = z.x.props.length - active;
      return `<option value="${z.i}">${z.x.name} (${active} deeds${mtg ? `, ${mtg} mortgaged` : ""})</option>`;
    })
    .join("");
  modal(
    "Negotiate a trade",
    `<div class="trade-form">
    <label for="tradeBot">Trade with</label><select id="tradeBot">${opt}</select>
    <label for="tradeCash">Offer cash</label><input id="tradeCash" type="number" min="0" max="${p.cash}" step="1" value="${Math.min(100, p.cash)}">
    <label for="tradeProp">Property requested</label><select id="tradeProp" size="1"></select>
    <p id="tradePropHint" class="small trade-prop-hint"></p>
    <div id="tradePropDetail" class="trade-prop-detail"></div></div>`,
    [
      {
        label: "Send offer",
        cls: "primary",
        fn: () => {
          const mb = $("mb");
          const bi = Number(mb.querySelector("#tradeBot")?.value);
          const bot = game.players[bi];
          const cash = Number(mb.querySelector("#tradeCash")?.value);
          const prop = Number(mb.querySelector("#tradeProp")?.value);
          if (!bot || !Number.isFinite(prop) || !bot.props.includes(prop) || cash < 0 || cash > p.cash) {
            toast("Pick a valid property and cash amount");
            return;
          }
          const fair = botTradeEvaluate(game, bot, cash, prop);
          const min = minimumTradePrice(game, prop);
          if (cash < min) {
            toast(`Offer must be at least $${min}`);
            return;
          }
          if (cash >= fair && Math.random() > (game.settings.difficulty === "hard" ? 0.22 : 0.38)) {
            if (executePropertyTrade(game, p, bot, prop, cash, say)) {
              renderAll();
              autoSave();
            }
          } else say(`${bot.name} rejected your offer.`);
        },
      },
      { label: "Cancel", fn: () => {} },
    ],
    { modalClass: "modal-trade" }
  );
  const mb = $("mb");
  const partnerSel = mb.querySelector("#tradeBot");
  const propSel = mb.querySelector("#tradeProp");
  const detailEl = mb.querySelector("#tradePropDetail");
  const hintEl = mb.querySelector("#tradePropHint");

  const cashInp = mb.querySelector("#tradeCash");

  const syncDetail = () => {
    if (!partnerSel || !propSel || !detailEl) return;
    const bi = Number(partnerSel.value);
    const bot = game.players[bi];
    const prop = Number(propSel.value);
    if (bot && Number.isFinite(prop) && bot.props.includes(prop)) {
      const a = asset(game, prop);
      const min = minimumTradePrice(game, prop);
      const bldgNote =
        a.houses > 0
          ? `<p class="small">Buildings add <b>$${money(buildingSellValue(prop, a.houses))}</b> (75% of build cost) to the minimum offer.</p>`
          : "";
      const mortNote = a.mortgaged
        ? `<p class="small warn-trade">⚠️ Mortgaged for <b>$${a.mortgagePrincipal || mortgageValue(prop)}</b> — bank takes <b>$${unmortgageCostForAsset(a, prop)}</b> (principal + 5%) from the sale; seller gets the rest.</p>`
        : "";
      detailEl.innerHTML =
        propertyDetailHTML(prop, true) +
        mortNote +
        bldgNote +
        `<p class="small">Minimum offer: <b>$${min}</b></p>`;
      if (cashInp) {
        cashInp.min = String(min);
        if (Number(cashInp.value) < min) cashInp.value = String(Math.min(min, p.cash));
      }
    } else {
      detailEl.innerHTML = "";
    }
  };

  const syncProps = () => {
    if (!partnerSel || !propSel) return;
    const bi = Number(partnerSel.value);
    const bot = game.players[bi];
    if (!bot) {
      propSel.innerHTML = `<option value="">—</option>`;
      if (hintEl) hintEl.textContent = "";
      syncDetail();
      return;
    }
    const list = [...new Set(bot.props || [])].filter((i) => BOARD[i] && (BOARD[i][2] > 0 || BOARD[i][4]));
    if (!list.length) {
      propSel.innerHTML = `<option value="">No tradable properties</option>`;
      if (hintEl) hintEl.textContent = `${bot.name} has nothing to sell right now.`;
      syncDetail();
      return;
    }
    propSel.innerHTML = list
      .map((i) => {
        const a = asset(game, i);
        const tag = a.mortgaged ? " · MORTGAGED" : a.houses === 5 ? " · Hotel" : a.houses ? ` · ${a.houses}H` : "";
        return `<option value="${i}">${spaceDisplayName(i)} · $${BOARD[i][2]}${tag}</option>`;
      })
      .join("");
    if (hintEl) hintEl.textContent = `${list.length} propert${list.length === 1 ? "y" : "ies"} available from ${bot.name}.`;
    syncDetail();
  };

  partnerSel?.addEventListener("change", syncProps);
  propSel?.addEventListener("change", syncDetail);
  syncProps();
}

function stats() {
  const s = game.stats;
  modal(
    "Match statistics",
    `<div class="statgrid">${[
      ["Round", game.round],
      ["Rolls", s.rolls],
      ["Purchases", s.buys],
      ["Auctions", s.auctions],
      ["Trades", s.trades],
      ["Buildings", s.builds],
      ["Mortgages", s.mortgages],
      ["Rent", "$" + s.rent],
      ["Taxes", "$" + s.taxes],
    ]
      .map((x) => `<div class="stat"><b>${x[1]}</b><span class="small">${x[0]}</span></div>`)
      .join("")}</div>`,
    [{ label: "Close", cls: "primary", fn: () => {} }]
  );
}

function finances() {
  const seat = activeSeat();
  const openFinance = () => {
    modal("Financial report", financeReportHTML(game, seat), [
      { label: "Manage assets", fn: () => manage() },
      { label: "Close", cls: "primary", fn: () => {} },
    ]);
    wireManagePropertyHandlers($("mb"), seat, { onRefresh: openFinance });
  };
  openFinance();
}

function settingsDialog() {
  modal(
    "Game settings",
    `<label>Theme</label><select id="theme"><option value="classic">Classic</option><option value="midnight">Midnight</option><option value="neon">Neon</option></select>
    <label>Difficulty</label><select id="difficulty"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select>
    <label>Country (new games only)</label><select id="countrySel"></select>
    <label><input id="hotseat" type="checkbox" style="width:auto"> Pass-and-play (4 humans on this device)</label>
    <label>Starting cash (new games)</label><select id="cash"><option>1200</option><option>1500</option><option>1800</option><option>2000</option></select>
    <label><input id="auction" type="checkbox" style="width:auto"> Auctions on decline</label>
    <label><input id="parking" type="checkbox" style="width:auto"> Free Parking jackpot</label>
    <label><input id="soundset" type="checkbox" style="width:auto"> Sound & music</label>
    <label><input id="animset" type="checkbox" style="width:auto"> Board animations</label>
    <label>Your avatar</label><select id="avatarSel"></select>
    <p class="small">Theme preview: change the dropdown to see the board recolour live. Your avatar appears on board tokens.</p>
    <p class="small">Official Monopoly-style rules: doubles (3→jail), jail bail, limited houses/hotels, even building.</p>`,
    [
      {
        label: "Apply",
        cls: "primary",
        fn: () => {
          game.settings.theme = $("theme").value;
          game.settings.difficulty = $("difficulty").value;
          if (!game.settings.countryLocked) {
            game.settings.country = $("countrySel").value;
            game.settings.hotseat = $("hotseat").checked;
            configurePlayersForMode();
          }
          game.settings.startingCash = +$("cash").value;
          game.settings.auction = $("auction").checked;
          game.settings.freeParking = $("parking").checked;
          game.settings.sound = $("soundset").checked;
          game.settings.animations = $("animset").checked;
          const seat = game.multiplayer?.localSeat ?? 0;
          game.players[seat].avatar = $("avatarSel").value;
          setSoundEnabled(game.settings.sound);
          stopSoundtrack();
          resumeSoundtrackIfEnabled(game);
          autoSave();
          renderAll();
          toast("Settings saved");
        },
      },
      { label: "Close", fn: () => {} },
    ]
  );
  $("theme").value = game.settings.theme;
  $("difficulty").value = game.settings.difficulty;
  $("countrySel").innerHTML = COUNTRY_OPTIONS.map((c) => `<option value="${c}">${c}</option>`).join("");
  $("countrySel").value = game.settings.country || "USA";
  $("countrySel").disabled = !!game.settings.countryLocked;
  $("hotseat").checked = !!game.settings.hotseat;
  $("hotseat").disabled = !!game.settings.countryLocked;
  $("cash").value = game.settings.startingCash;
  $("auction").checked = game.settings.auction;
  $("parking").checked = game.settings.freeParking;
  $("soundset").checked = game.settings.sound;
  $("animset").checked = game.settings.animations;
  $("avatarSel").innerHTML = ["🎩", "🚀", "🏛️", "🎨", "🦊", "🐼", "⚡", "👑"]
    .map((a) => `<option value="${a}">${a}</option>`)
    .join("");
  const seat = game.multiplayer?.localSeat ?? 0;
  $("avatarSel").value = game.players[seat].avatar;
  $("theme").onchange = () => {
    setTheme($("theme").value);
    renderBoard(game, game.pending?.space);
    renderPlayers(game);
  };
  $("avatarSel").onchange = () => {
    const seat = game.multiplayer?.localSeat ?? 0;
    game.players[seat].avatar = $("avatarSel").value;
    renderBoard(game, game.pending?.space);
    renderPlayers(game);
  };
}

function multiplayerDialog() {
  const defaultUrl = localStorage.getItem("ptyWsUrl") || "ws://localhost:8787";
  modal(
    "Play with friends",
    `<p class="small">Host a room or join with a 6-letter code. Only the active seat can roll and buy.</p>
    <label>Server URL (wss recommended in production)</label>
    <input id="wsUrl" value="${defaultUrl}">
    <label>Display name</label><input id="mpName" maxlength="24" value="${game.players[0].name}">
    <label>Room code (join)</label><input id="roomCode" maxlength="6" placeholder="ABC123">
    <p class="mp-status" id="mpStatus">Offline — local vs AI</p>`,
    [
      {
        label: "Host room",
        cls: "primary",
        fn: () => connectMp(true),
      },
      { label: "Join room", fn: () => connectMp(false) },
      {
        label: "Disconnect",
        fn: () => {
          mp?.disconnect();
          clearMultiplayer(game);
          toast("Disconnected");
          renderAll();
        },
      },
      { label: "Close", fn: () => {} },
    ]
  );
}

async function connectMp(host) {
  const url = $("wsUrl").value.trim();
  localStorage.setItem("ptyWsUrl", url);
  mp = new MultiplayerClient({
    onMessage(msg) {
      if (msg.type === "room_created" || msg.type === "room_joined") {
        attachMultiplayerMeta(game, {
          roomCode: msg.payload.code,
          seat: msg.payload.seat,
          isHost: msg.payload.isHost,
          serverUrl: url,
          saveToken: msg.payload.saveToken,
        });
        game.players[msg.payload.seat].name = msg.payload.name;
        game.players[msg.payload.seat].bot = false;
        if (msg.payload.isHost) {
          game.players.forEach((pl, i) => {
            if (i !== msg.payload.seat) pl.bot = true;
          });
        }
        $("mpStatus").textContent = `Room ${msg.payload.code} · seat ${msg.payload.seat + 1}`;
        toast(host ? "Room created" : "Joined room");
        if (msg.payload.isHost) syncMultiplayer("room");
        renderAll();
      }
      if (msg.type === "player_joined" && game.multiplayer?.isHost) {
        const s = msg.payload.seat;
        if (s >= 0 && s < 4) {
          game.players[s].bot = false;
          game.players[s].name = msg.payload.name;
          syncMultiplayer("join");
          renderAll();
        }
      }
      if (msg.type === "game_state" && !game.multiplayer?.isHost) {
        const state = msg.payload.state;
        if (state?.version === 3) {
          const meta = game.multiplayer;
          game = state;
          game.multiplayer = meta;
          initDecks(game);
          renderAll();
        }
      }
      if (msg.type === "cloud_saved") toast("Cloud save synced");
      if (msg.type === "cloud_loaded" && msg.payload?.state) {
        game = msg.payload.state;
        attachMultiplayerMeta(game, msg.payload.meta);
        renderAll();
        toast("Cloud save loaded");
      }
      if (msg.type === "error") toast(msg.payload?.message || "Error");
    },
    onDisconnect() {
      toast("Disconnected from server");
    },
  });
  try {
    await mp.connect(url);
    const name = $("mpName").value;
    if (host) mp.createRoom(name, game.settings.theme);
    else mp.joinRoom($("roomCode").value, name);
  } catch {
    toast("Could not connect");
  }
}

function cloudSave() {
  if (!game.multiplayer?.saveToken) {
    toast("Join multiplayer to enable cloud sync");
    return;
  }
  mp.saveCloud("main", game, game.multiplayer.saveToken);
}

function exportSave() {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "property-tycoon-save.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported");
}

function importSave() {
  $("fileInput").click();
}

function buildNewGamePlayerFields(count) {
  const hotseat = $("mb")?.querySelector("#ngHotseat")?.checked;
  let html = "";
  for (let i = 0; i < count; i++) {
    const defName = game.settings.playerNames?.[i] ?? DEFAULT_NAMES[i] ?? `Player ${i + 1}`;
    const defAv = game.players[i]?.avatar ?? AVATARS[i % AVATARS.length];
    const avOpts = AVATARS.map(
      (a) => `<option value="${a}"${a === defAv ? " selected" : ""}>${a}</option>`
    ).join("");
    const role =
      i === 0 ? "You" : hotseat ? `Player ${i + 1}` : `Opponent ${i} (bot)`;
    html += `<div class="ng-player-block"><h4>${role}</h4>
      <label for="ngName${i}">Name</label>
      <input id="ngName${i}" type="text" maxlength="24" value="${defName.replace(/"/g, "&quot;")}">
      <label for="ngAv${i}">Avatar</label>
      <select id="ngAv${i}">${avOpts}</select></div>`;
  }
  return html;
}

function refreshNewGameModalFields() {
  const mb = $("mb");
  if (!mb) return;
  const count = Number(mb.querySelector("#ngPlayerCount")?.value || 4);
  const host = mb.querySelector("#ngPlayerFields");
  if (host) host.innerHTML = buildNewGamePlayerFields(count);
}

function applyNewGameSetup(country, playerCount, hotseat, names, avatars) {
  game = createGame({
    startingCash: game.settings.startingCash,
    difficulty: game.settings.difficulty,
    country,
    hotseat,
    playerNames: names,
    playerCount,
  });
  applyCountryToBoard(BOARD, country);
  game.settings.country = country;
  game.settings.hotseat = hotseat;
  game.settings.playerCount = playerCount;
  game.settings.countryLocked = true;

  game.players.forEach((p, i) => {
    p.inactive = i >= playerCount;
    p.bankrupt = false;
    p.name = names[i] || DEFAULT_NAMES[i];
    p.avatar = avatars[i] || AVATARS[i % AVATARS.length];
    if (p.inactive) {
      p.bot = true;
      p.props = [];
      p.cash = 0;
      return;
    }
    if (hotseat) {
      p.bot = false;
    } else {
      p.bot = i !== 0;
      if (i > 0 && BOT_ROSTER[i - 1]) {
        p.personality = BOT_ROSTER[i - 1].personality;
      }
    }
  });

  if (game.multiplayer && !hotseat) {
    const seat = game.multiplayer.localSeat ?? 0;
    game.players.forEach((p, i) => {
      if (!p.inactive) p.bot = i !== seat;
    });
  }

  game.paused = false;
  game.turn = 0;
  while (game.players[game.turn]?.inactive) {
    game.turn = (game.turn + 1) % 4;
  }
  syncPlayerNamesToSettings();
  say(`New match — ${playerCount} players · ${country} board.`);
  renderAll();
  autoSave();
  syncMultiplayer("new");
  if (game.players[game.turn].bot) scheduleBotPlay();
}

function newGame() {
  const countryOpts = COUNTRY_OPTIONS.map(
    (c) =>
      `<option value="${c}"${c === (game.settings.country || "USA") ? " selected" : ""}>${c}</option>`
  ).join("");
  const pc = game.settings.playerCount ?? 4;
  modal(
    "Start new game",
    `<label for="ngPlayerCount">Number of players</label>
    <select id="ngPlayerCount">
      <option value="2"${pc === 2 ? " selected" : ""}>2 players</option>
      <option value="3"${pc === 3 ? " selected" : ""}>3 players</option>
      <option value="4"${pc === 4 ? " selected" : ""}>4 players</option>
    </select>
    <label for="ngCountry">Country / city names</label>
    <select id="ngCountry">${countryOpts}</select>
    <label><input id="ngHotseat" type="checkbox" style="width:auto"${game.settings.hotseat ? " checked" : ""}> Pass-and-play (all seats are human)</label>
    <div id="ngPlayerFields" class="ng-player-fields"></div>
    <p class="small">Inactive seats are left out of turns. Your name and avatar appear on the board.</p>`,
    [
      {
        label: "Start game",
        cls: "primary",
        fn: () => {
          const mb = $("mb");
          const playerCount = Number(mb.querySelector("#ngPlayerCount")?.value || 4);
          const country = mb.querySelector("#ngCountry")?.value || "USA";
          const hotseat = !!mb.querySelector("#ngHotseat")?.checked;
          const names = [];
          const avatars = [];
          for (let i = 0; i < 4; i++) {
            names.push(
              i < playerCount
                ? (mb.querySelector(`#ngName${i}`)?.value.trim() || DEFAULT_NAMES[i])
                : DEFAULT_NAMES[i]
            );
            avatars.push(
              i < playerCount
                ? mb.querySelector(`#ngAv${i}`)?.value || AVATARS[i]
                : AVATARS[i]
            );
          }
          game.settings.hotseat = hotseat;
          applyNewGameSetup(country, playerCount, hotseat, names, avatars);
        },
      },
      { label: "Cancel", fn: () => {} },
    ],
    { modalClass: "modal-newgame" }
  );
  const mb = $("mb");
  mb.querySelector("#ngPlayerCount")?.addEventListener("change", refreshNewGameModalFields);
  mb.querySelector("#ngHotseat")?.addEventListener("change", refreshNewGameModalFields);
  refreshNewGameModalFields();
}

function load() {
  try {
    const s = localStorage.getItem("propertyTycoonAdvanced");
    if (!s) {
      toast("No save");
      return;
    }
    const x = JSON.parse(s);
    const migrated = migrateSave(x);
    if (!migrated) throw new Error();
    game = normalizeV3(migrated) || createGame();
    applyCountryToBoard(BOARD, game.settings?.country || "USA");
    syncPlayerNamesFromSettings();
    syncBotFlagsOnly();
    renderAll();
    autoSaveNow();
    toast("Resumed");
    resumeGameAfterLoad();
  } catch {
    toast("Could not load");
  }
}

function bindUi() {
  const playersHost = $("players");
  if (playersHost && !playersHost.dataset.nameEditBound) {
    playersHost.dataset.nameEditBound = "1";
    const commitName = (inp) => {
      const seat = Number(inp.dataset.seat);
      if (!Number.isFinite(seat) || !game.players[seat]) return;
      const next = inp.value.trim().slice(0, 24) || game.players[seat].name;
      inp.value = next;
      if (game.players[seat].name === next) return;
      game.players[seat].name = next;
      syncPlayerNamesToSettings();
      renderBoard(game, game.pending?.space);
      renderPlayers(game);
      autoSave();
    };
    playersHost.addEventListener("input", (e) => {
      const inp = e.target.closest(".player-name-input");
      if (!inp) return;
      const seat = Number(inp.dataset.seat);
      if (game.players[seat]) {
        game.players[seat].name = inp.value.slice(0, 24);
        syncPlayerNamesToSettings();
        autoSave();
      }
    });
    playersHost.addEventListener("change", (e) => {
      const inp = e.target.closest(".player-name-input");
      if (inp) commitName(inp);
    });
    playersHost.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const inp = e.target.closest(".player-name-input");
      if (inp) {
        e.preventDefault();
        inp.blur();
        commitName(inp);
      }
    });
  }

  $("passBtn").onclick = () => {
    if (rolling || game.animating) {
      game._skipAnimations = true;
      releasePlayLocks();
      renderAll();
      return;
    }
    if (game.rolled && !game.mustRollAgain && !game.pending && !game.auction) {
      endTurnClick();
    } else {
      toast("Finish your roll or decision first.");
    }
  };
  $("rollBtn").onclick = roll;
  $("endBtn").onclick = endTurnClick;
  $("undoBtn").onclick = () => {
    const seat = activeSeat();
    if (!canUndo(game, seat, { rolling })) return;
    const prev = popUndoState(game);
    if (!prev) return;
    const meta = game.multiplayer;
    const restored = normalizeV3(prev);
    if (!restored) {
      toast("Could not undo — state was invalid.");
      return;
    }
    game = restored;
    if (meta) game.multiplayer = meta;
    cardRevealQueue = [];
    landingNoticeQueue = [];
    releasePlayLocks();
    clearAuctionBidTimer();
    clearAuctionTimer();
    applyCountryToBoard(BOARD, game.settings?.country || "USA");
    renderAll();
    autoSaveNow();
    resumeTurnAfterPause();
    toast("Undid last action.");
  };
  $("manageBtn").onclick = manage;
  $("tradeBtn").onclick = trade;
  $("statsBtn").onclick = stats;
  $("financeBtn").onclick = finances;
  $("pauseBtn").onclick = togglePause;
  $("settingsBtn").onclick = settingsDialog;
  $("saveBtn").onclick = () => {
    autoSaveNow();
    toast("Saved locally");
  };
  window.addEventListener("pagehide", () => autoSaveNow());
  window.addEventListener("beforeunload", () => autoSaveNow());
  $("loadBtn").onclick = load;
  $("newBtn").onclick = newGame;
  $("exportBtn").onclick = exportSave;
  $("importBtn").onclick = importSave;
  $("mpBtn").onclick = multiplayerDialog;
  $("cloudBtn").onclick = cloudSave;
  $("soundBtn").onclick = () => {
    setSoundEnabled(!isSoundOn());
    $("soundBtn").textContent = isSoundOn() ? "🔊 Sound: On" : "🔇 Sound: Off";
    sfx(520);
  };
  $("modalbg").addEventListener("click", (e) => {
    if (e.target !== $("modalbg")) return;
    if (game.auction) {
      toast("Finish the auction — place a bid or pass.");
      return;
    }
    closeModal();
  });
  $("fileInput").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const x = JSON.parse(r.result);
        const migrated = migrateSave(x);
        if (!migrated) throw new Error();
        game = migrated;
        initDecks(game);
        renderAll();
        autoSave();
        toast("Imported");
      } catch {
        toast("Invalid save");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };
}

function sanitizeAuctionState(g) {
  const a = g.auction;
  if (!a) return;
  const ok =
    Number.isFinite(a.space) &&
    a.space >= 0 &&
    a.space < 40 &&
    Array.isArray(a.eligible) &&
    a.eligible.length > 0 &&
    Number.isFinite(a.current) &&
    a.eligible.includes(a.current);
  if (!ok) g.auction = null;
}

function sanitizeUndoStack(g) {
  if (!Array.isArray(g.undoStack)) {
    g.undoStack = [];
    return;
  }
  const clean = [];
  for (const entry of g.undoStack) {
    if (typeof entry !== "string") continue;
    try {
      const o = JSON.parse(entry);
      if (!Array.isArray(o.players) || o.players.length !== 4) continue;
      clean.push(entry);
    } catch {
      /* skip corrupt snapshot */
    }
  }
  g.undoStack = clean.slice(-12);
}

function normalizeV3(g) {
  if (!g || !Array.isArray(g.players) || g.players.length !== 4) return null;
  g.bank = g.bank || { houses: 32, hotels: 12 };
  g.lastDice = g.lastDice || [1, 1];
  g.pending = g.pending ?? null;
  g.mustRollAgain = !!g.mustRollAgain;
  g.paused = !!g.paused;
  g.animating = false;
  rolling = false;
  cardRevealQueue = [];
  landingNoticeQueue = [];
  sanitizeAuctionState(g);
  normalizeAssetStore(g);
  reconcileOwnership(g);
  if (!g.diceCardMaps) initDecks(g);
  g.market = g.market || { staleRounds: 0, buysSinceCheck: false };
  sanitizeUndoStack(g);
  if (g.settings?.country) applyCountryToBoard(BOARD, g.settings.country);
  g.lastDraw = g.lastDraw || {};
  g.settings = g.settings || {};
  g.settings.theme = g.settings.theme || "classic";
  if (!g.settings.playerNames) g.settings.playerNames = g.players.map((p) => p.name);
  else if (g.settings.playerNames.length === 4) {
    g.players.forEach((p, i) => {
      if (g.settings.playerNames[i]) p.name = g.settings.playerNames[i];
    });
  }
  g.players?.forEach((p, i) => {
    p.getOutCards = p.getOutCards ?? 0;
    p.jailTurns = p.jailTurns ?? 0;
    p.doublesInRow = p.doublesInRow ?? 0;
    p.avatar = p.avatar ?? ["🎩", "🚀", "🏛️", "🎨"][i];
    p.color = PLAYER_COLORS[i];
    p.inactive = !!p.inactive;
    if (p.inactive) p.bot = true;
  });
  const pc = g.settings.playerCount ?? 4;
  g.settings.playerCount = pc;
  g.players.forEach((p, i) => {
    if (i >= pc) p.inactive = true;
  });
  return g;
}

function migrateSave(x) {
  if (x.version === 3) return normalizeV3(x) || createGame();
  if (x.version !== 2) return null;
  const g = createGame();
  g.players = x.players.map((p, i) => ({
    ...g.players[i],
    ...p,
    getOutCards: p.getOutCards ?? p.getOut ?? 0,
    jailTurns: p.jailTurns ?? 0,
    doublesInRow: 0,
    avatar: p.avatar ?? g.players[i].avatar,
  }));
  g.assets = x.assets || {};
  g.turn = x.turn ?? 0;
  g.rolled = x.rolled ?? false;
  g.done = x.done ?? false;
  g.round = x.round ?? 1;
  g.pot = x.pot ?? 0;
  g.log = x.log || [];
  g.stats = { ...g.stats, ...x.stats };
  g.settings = {
    ...g.settings,
    ...x.settings,
    theme: x.settings?.theme ?? "classic",
    playerNames: x.settings?.playerNames || g.players.map((p) => p.name),
  };
  g.lastRoll = x.lastRoll;
  g.auction = x.auction;
  g.bank = x.bank || { houses: 32, hotels: 12 };
  return g;
}

async function boot() {
  try {
    await ensureBoardSprite();
    bindUi();
    bindCenterDeckClicks();
    try {
      const saved = localStorage.getItem("propertyTycoonAdvanced");
      if (saved) {
        const x = JSON.parse(saved);
        const migrated = migrateSave(x);
        if (migrated) game = normalizeV3(migrated) || createGame();
      }
    } catch {
      game = createGame();
    }
    game = normalizeV3(game) || game;
    applyCountryToBoard(BOARD, game.settings?.country || "USA");
    syncPlayerNamesFromSettings();
    syncBotFlagsOnly();
    if (!game.settings.theme) game.settings.theme = "classic";
    if (!game.log.length) say("Property Tycoon Phase 3 — roll from the board centre.");
    setSoundEnabled(game.settings?.sound !== false);
    renderAll();
    resumeGameAfterLoad();
  } catch (err) {
    console.error(err);
    const el = document.getElementById("toast");
    if (el) {
      el.textContent = "Game failed to start — try a hard refresh or clear site data.";
      el.classList.add("show");
    }
  }
}

boot();

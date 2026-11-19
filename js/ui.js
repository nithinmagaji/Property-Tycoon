import {
  BOARD,
  COORDS,
  DEFAULT_NAMES,
  PLAYER_COLORS,
  spaceVisual,
  spaceDisplayName,
  GO_INDEX,
  minimumRentForIndex,
  isProperty,
  money,
  SELL_BUILDING_FRACTION,
} from "./data.js";
import {
  asset,
  worth,
  activePropertyCount,
  worthLeaderPercent,
  rentAmount,
  houseCostFor,
  unmortgageCost,
  mortgageValue,
  canBuildOn,
  buildBlockReason,
  canSellOn,
  sellBlockReason,
} from "./engine.js";
import {
  catalogForSpace,
  cardCatalogHTML,
  cardDrawModalHTML,
  renderCenterDecks,
} from "./cards.js";
import { auctionBidStatusHTML } from "./board-info.js";

const $ = (id) => document.getElementById(id);
/** 3 board spaces in 2 seconds */
export const MOVE_MS_PER_SPACE = 2000 / 3;
let spriteReady = false;

export async function ensureBoardSprite() {
  if (spriteReady || document.getElementById("board-sprite-inline")) {
    spriteReady = true;
    return;
  }
  try {
    const res = await fetch("assets/board-sprite.svg");
    if (!res.ok) return;
    const svg = await res.text();
    const host = document.createElement("div");
    host.id = "board-sprite-inline";
    host.hidden = true;
    host.innerHTML = svg;
    document.body.appendChild(host);
    spriteReady = true;
  } catch {
    /* offline / file */
  }
}
const PIP_ON = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function clampDie(n) {
  return Math.max(1, Math.min(6, n | 0));
}

function dieMarkup(value, rolling) {
  const n = clampDie(value);
  const cells = Array.from({ length: 9 }, (_, i) => {
    const on = PIP_ON[n].includes(i);
    return `<i class="${on ? "on" : ""}"></i>`;
  }).join("");
  return `<div class="die" role="img" aria-label="Die showing ${n}">
    <div class="die-inner${rolling ? " rolling" : ""}">
      <div class="die-face">
        <span class="die-num">${n}</span>
        <div class="pips">${cells}</div>
      </div>
    </div>
  </div>`;
}

export function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1900);
}

export function modal(title, body, buttons, opts = {}) {
  const shell = document.querySelector("#modalbg .modal");
  if (shell) {
    shell.className = "modal";
    if (opts.modalClass) shell.classList.add(opts.modalClass);
    shell.style.cssText = "";
    if (opts.cssVars) {
      Object.entries(opts.cssVars).forEach(([k, v]) => shell.style.setProperty(k, v));
    }
  }
  $("mt").textContent = title;
  $("mb").innerHTML = body;
  const ma = $("ma");
  ma.innerHTML = "";
  buttons.forEach((b) => {
    const x = document.createElement("button");
    x.textContent = b.label;
    x.className = b.cls || "";
    x.onclick = () => {
      closeModal();
      b.fn && b.fn();
    };
    ma.appendChild(x);
  });
  $("modalbg").classList.add("show");
}

export function closeModal() {
  $("modalbg").classList.remove("show");
}

export function setTheme(theme) {
  const t = theme || "classic";
  document.body.setAttribute("data-theme", t);
}

export function renderLog(game) {
  $("log").innerHTML = game.log.map((x) => `<div>${x}</div>`).join("");
}

export function renderDice(d1, d2, rolling = false, lastRoll = null) {
  const wrap = $("dice3d");
  const totalEl = $("diceTotal");
  if (!wrap) return;
  const a = clampDie(d1);
  const b = clampDie(d2);
  wrap.innerHTML = dieMarkup(a, rolling) + dieMarkup(b, rolling);
  if (totalEl) {
    if (rolling) totalEl.textContent = "Rolling…";
    else if (lastRoll != null) totalEl.textContent = `${a} + ${b} = ${lastRoll}`;
    else totalEl.textContent = "Ready to roll";
  }
}

function spriteThumb(spriteId, tint, spaceIndex) {
  const tintStyle = tint ? ` style="--thumb-tint:${tint}22"` : "";
  const icon = `<div class="space-thumb-icon"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#${spriteId}"></use></svg></div>`;
  if (spaceIndex === GO_INDEX) {
    const arrow = `<span class="go-start-arrow" title="Play direction — follow the arrow from Start">
      <svg class="go-arrow-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>`;
    return `<div class="space-thumb space-thumb-go"${tintStyle}>${icon}${arrow}</div>`;
  }
  return `<div class="space-thumb"${tintStyle}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><use href="#${spriteId}"></use></svg>
  </div>`;
}

function tokenMarkup(p) {
  const label = (p.avatar || p.name[0] || "?").trim();
  return `<span class="board-token on-icon" style="--token-ring:${p.color}" title="${p.name}">
    <span class="board-token-emoji">${label}</span>
  </span>`;
}

/** Which side of the board this rim space faces (for outside owner labels). */
function boardEdge(r, c) {
  if (r === 10) return "south";
  if (r === 0) return "north";
  if (c === 0) return "west";
  if (c === 10) return "east";
  return "north";
}

export function renderBoard(game, highlightIndex = null, moveHighlightColor = null) {
  const b = $("board");
  if (!b || !game?.players) return;
  b.querySelectorAll(".space").forEach((x) => x.remove());
  BOARD.forEach((g, i) => {
    const el = document.createElement("div");
    const [r, c] = COORDS[i];
    const a = asset(game, i);
    const tokens = game.players.filter((p) => p.pos === i && !p.bankrupt);
    const vis = spaceVisual(i);
    let cls = `space space-${vis.type} scene-${vis.scene}`;
    if (highlightIndex === i) {
      cls += " lit move-step";
      if (moveHighlightColor) el.style.setProperty("--move-highlight", moveHighlightColor);
    }
    if (a.owner !== null && g[2] > 0) {
      cls += ` owned edge-${boardEdge(r, c)}`;
      if (a.mortgaged) cls += " owned-mortgaged";
    }
    el.className = cls;
    el.dataset.space = String(i);
    el.style.gridRow = r + 1;
    el.style.gridColumn = c + 1;
    if (g[1]) el.style.setProperty("--space-tint", g[1]);
    const owner = a.owner !== null ? game.players[a.owner] : null;
    if (owner) {
      const ring = owner.color || PLAYER_COLORS[a.owner];
      el.style.setProperty("--owner-ring", ring);
      el.dataset.owner = owner.name;
    }
    const displayName = spaceDisplayName(i);
    el.innerHTML = `${
      owner
        ? `<div class="owner-rim" style="--owner-ring:${owner.color || PLAYER_COLORS[a.owner]}" title="${owner.name}"></div>
    <div class="owner-outside" style="--owner-ring:${owner.color || PLAYER_COLORS[a.owner]}" title="${owner.name}">
      <span class="owner-outside-av">${owner.avatar || owner.name[0] || "?"}</span>
      <span class="owner-outside-nm">${owner.name.split(" ")[0]}</span>
    </div>`
        : ""
    }<div class="space-fill">
      ${g[1] ? `<div class="band" style="--band:${g[1]}"></div>` : ""}
      <div class="space-thumb-wrap">${spriteThumb(vis.sprite, g[1], i)}
        <div class="tokens">${tokens.map((p) => tokenMarkup(p)).join("")}</div>
      </div>
      <div class="space-meta">
        <span class="nm">${displayName}</span>
        ${
          g[2] || vis.type === "card"
            ? `<span class="cost">${g[2] ? "$" + g[2] + (isProperty(i) ? " · $" + g[3] + "+" : "") : vis.type === "card" ? "Draw" : ""}</span>`
            : ""
        }
      </div>
      ${
        owner
          ? `<div class="owner-tag compact" style="--owner-color:${owner.color || PLAYER_COLORS[a.owner]}" title="${owner.name}">
        ${
          a.mortgaged
            ? "<span class='tag-m'>M</span>"
            : a.houses
              ? `<span class="tag-bldg">${a.houses === 5 ? "🏨 Hotel" : "🏠".repeat(Math.min(a.houses, 4))}</span>`
              : `<span class="owner-dot" style="background:${owner.color || PLAYER_COLORS[a.owner]}"></span>`
        }</div>`
          : ""
      }
    </div>`;
    el.title =
      displayName +
      (vis.type === "card" ? " — see deck in board centre" : "") +
      (owner ? " — " + owner.name : "");
    b.appendChild(el);
  });
  renderCenterDecks(game);
}

export function showCardDrawModal(deckLabel, card, accent, onClose) {
  modal(`${deckLabel} card`, cardDrawModalHTML(deckLabel, card, accent), [
    {
      label: "OK",
      cls: "primary",
      fn: () => {
        onClose?.();
      },
    },
  ]);
}

export function showCardCatalogModal(deckKey) {
  const chance = catalogForSpace("Chance");
  const comm = catalogForSpace("Community Fund");
  const cat =
    deckKey === "chance" ? chance : deckKey === "community" ? comm : chance;
  if (!cat) return;
  modal(cat.label, cardCatalogHTML(cat.label, cat.cards, cat.accent), [
    { label: "Close", cls: "primary", fn: () => {} },
  ]);
}

export function bindCenterDeckClicks() {
  const host = $("centerDecks");
  if (!host || host.dataset.deckClickBound) return;
  host.dataset.deckClickBound = "1";
  host.addEventListener("click", (e) => {
    const btn = e.target.closest(".deck-expand-btn");
    if (btn?.dataset.deck) showCardCatalogModal(btn.dataset.deck);
  });
}

export function renderPlayers(game) {
  $("players").innerHTML = game.players
    .map((p, i) => {
      if (p.inactive) return "";
      const active = i === game.turn;
      const waiting = game.multiplayer && game.multiplayer.localSeat !== i && active;
      const av = p.avatar || "🎮";
      const safeName = String(p.name)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");
      const tag = p.bot ? `<span class="player-bot-tag"> · ${p.personality}</span>` : "";
      return `<div class="player ${active ? "active" : ""} ${waiting ? "waiting" : ""}" data-seat="${i}" style="${
        p.bankrupt ? "opacity:.38" : ""
      }"><div class="ph"><span class="player-ident">
        <span class="board-token sm" style="--token-ring:${p.color}"><span class="board-token-emoji">${av}</span></span>
        <input class="player-name-input" type="text" maxlength="24" data-seat="${i}" value="${safeName}" readonly title="Set name in New game" aria-label="Player ${i + 1} name" />${tag}</span><span class="cash">$${p.cash}</span></div>
      <div class="small">${
        p.bankrupt
          ? "Bankrupt"
          : `Net worth $${worth(game, p)} · ${activePropertyCount(game, p)} deeds${p.jail ? " · Jail" : ""}${p.props.length > activePropertyCount(game, p) ? ` · ${p.props.length - activePropertyCount(game, p)} mortgaged` : ""}`
      }</div>
      <div class="bar" title="Share of highest net worth among players in the game"><i style="width:${Math.max(0, Math.min(100, worthLeaderPercent(game, p)))}%"></i></div></div>`;
    })
    .join("");
}

export function renderPortfolio(game, seat = 0) {
  const p = game.players[seat];
  $("portfolio").innerHTML = p.props.length
    ? p.props
        .map((i) => {
          const a = asset(game, i);
          return `<span class="pill">${BOARD[i][0]}${a.mortgaged ? " · M" : a.houses ? " · " + (a.houses === 5 ? "Hotel" : a.houses + "H") : ""}</span>`;
        })
        .join("")
    : "No properties yet.";
}

export function renderAuctionStatus(game) {
  const el = $("auctionStatus");
  if (!el) return;
  if (!game.auction) {
    el.classList.remove("show");
    el.innerHTML = "";
    return;
  }
  const space = BOARD[game.auction.space][0];
  el.classList.add("show");
  el.innerHTML = `<h3>🔨 Live auction — ${space}</h3>${auctionBidStatusHTML(game)}`;
}

export function getActiveSeat(game) {
  if (game.settings?.hotseat) return game.turn;
  return game.multiplayer?.localSeat ?? 0;
}

export function renderPurchasePanel(game, handlers) {
  const panel = $("purchasePanel");
  const pending = game.pending;
  if (
    !pending ||
    (pending.type !== "buy" &&
      pending.type !== "incomeTax" &&
      pending.type !== "jail" &&
      pending.type !== "jailFreeChoice")
  ) {
    panel.classList.remove("show");
    panel.innerHTML = "";
    return;
  }
  const localSeat = getActiveSeat(game);
  const canAct = pending.player === localSeat;
  panel.classList.add("show");

  if (pending.type === "buy") {
    const i = pending.space;
    const g = BOARD[i];
    const p = game.players[pending.player];
    const vis = spaceVisual(i);
    panel.innerHTML = `<h3>Property: ${g[0]}</h3>
      <div class="purchase-thumb"><svg viewBox="0 0 64 64"><use href="#${vis.sprite}"></use></svg></div>
      <p class="small">Price <b>$${g[2]}</b> · Site rent from <b>$${minimumRentForIndex(i)}</b> · Building rent 25%–55% of price · ${canAct ? "Your decision" : p.name + " is deciding"}</p>
      <p id="purchaseTimer" class="small purchase-timer"></p>
      <p class="small">Cash: $${p.cash} · After purchase: $${p.cash - g[2]}</p>
      <div class="actions" id="purchaseActions">
        <button class="primary" id="buyBtn" ${!canAct || p.cash < g[2] ? "disabled" : ""}>Buy property</button>
        <button id="auctionBtn" ${!canAct ? "disabled" : ""}>Auction</button>
        <button class="mutedbtn" id="passBtn" ${!canAct ? "disabled" : ""}>Pass</button>
      </div>`;
    if (canAct) {
      $("buyBtn").onclick = () => handlers.onBuy(i);
      $("auctionBtn").onclick = () => handlers.onAuction(i);
      $("passBtn").onclick = () => handlers.onPass(i);
    }
  }

  if (pending.type === "incomeTax") {
    const p = game.players[pending.player];
    const w = worth(game, p);
    const pct = Math.floor(w * 0.1);
    panel.innerHTML = `<h3>Income Tax</h3>
      <p class="small">Pay <b>$200</b> or <b>10%</b> of net worth ($${pct}).</p>
      <div class="actions">
        <button class="primary" id="tax200" ${!canAct ? "disabled" : ""}>Pay $200</button>
        <button id="taxPct" ${!canAct ? "disabled" : ""}>Pay 10% ($${pct})</button>
      </div>`;
    if (canAct) {
      $("tax200").onclick = () => handlers.onTax(false);
      $("taxPct").onclick = () => handlers.onTax(true);
    }
  }

  if (pending.type === "jailFreeChoice") {
    const p = game.players[pending.player];
    panel.innerHTML = `<h3>Get Out of Jail Free?</h3>
      <p class="small">${pending.reason || "You would go to Jail"}. You have ${p.getOutCards} card(s).</p>
      <div class="actions">
        <button class="primary" id="useJailFree" ${!canAct ? "disabled" : ""}>Use card (avoid Jail)</button>
        <button id="goToJailBtn" ${!canAct ? "disabled" : ""}>Go to Jail</button>
      </div>`;
    if (canAct) {
      $("useJailFree").onclick = () => handlers.onJailFreeChoice(true);
      $("goToJailBtn").onclick = () => handlers.onJailFreeChoice(false);
    }
  }

  if (pending.type === "jail") {
    const p = game.players[pending.player];
    panel.innerHTML = `<h3>In Jail</h3>
      <p class="small">Pay $50, use a card (${p.getOutCards}), or roll next turn for doubles.</p>
      <div class="actions">
        <button class="primary" id="jailPay" ${!canAct || p.cash < 50 ? "disabled" : ""}>Pay $50</button>
        <button id="jailCard" ${!canAct || !p.getOutCards ? "disabled" : ""}>Use card</button>
        <button class="mutedbtn" id="jailRoll" ${!canAct ? "disabled" : ""}>Stay for now</button>
      </div>`;
    if (canAct) {
      $("jailPay").onclick = () => handlers.onJail("pay");
      $("jailCard").onclick = () => handlers.onJail("card");
      $("jailRoll").onclick = () => handlers.onJail("wait");
    }
  }
}

export function renderLockBanner(game) {
  const el = $("lockBanner");
  if (!game.multiplayer?.connected) {
    el.classList.remove("show");
    return;
  }
  const local = game.multiplayer.localSeat;
  const isMyTurn = game.turn === local;
  const pendingOther = game.pending && game.pending.player !== local;
  const show = !isMyTurn || pendingOther || game.animating;
  el.classList.toggle("show", show);
  el.textContent = game.animating
    ? "Pieces are moving…"
    : pendingOther
      ? `${game.players[game.pending.player].name} is making a decision…`
      : `Waiting for ${game.players[game.turn].name}'s turn.`;
}

export function updateControlStates(game, rolling) {
  const localSeat = getActiveSeat(game);
  const p = game.players[game.turn];
  const isLocalTurn = game.settings?.hotseat
    ? game.turn === localSeat
    : game.turn === localSeat && !p.bot;
  const blocked =
    game.paused ||
    game.done ||
    game.pending ||
    game.auction ||
    game.animating ||
    rolling ||
    !isLocalTurn;

  const canRollAgain = game.mustRollAgain && isLocalTurn && !game.pending && !game.auction;
  $("rollBtn").disabled = blocked || (game.rolled && !canRollAgain);
  $("manageBtn").disabled = game.done || game.paused;
  $("tradeBtn").disabled = game.done || game.paused;
  const pauseBtn = $("pauseBtn");
  if (pauseBtn) {
    pauseBtn.textContent = game.paused ? "▶ Resume" : "⏸ Pause";
    pauseBtn.disabled = game.done;
  }
  const pauseOv = $("pauseOverlay");
  if (pauseOv) pauseOv.classList.toggle("show", !!game.paused);
  const passBtn = $("passBtn");
  if (passBtn) {
    const canPass =
      isLocalTurn &&
      !game.paused &&
      !game.done &&
      !game.auction &&
      (rolling ||
        game.animating ||
        (game.rolled && !game.mustRollAgain && !game.pending));
    passBtn.disabled = !canPass;
    passBtn.textContent =
      rolling || game.animating ? "Skip animation" : "Pass turn";
  }
  const endBtn = $("endBtn");
  if (endBtn) {
    endBtn.disabled = true;
    endBtn.title = "Turns advance automatically after your move";
    endBtn.classList.add("hidden");
  }

  $("turnLabel").textContent = game.paused
    ? "Game paused"
    : p.name +
      (p.bot
        ? " is playing…"
        : canRollAgain
          ? " — rolled doubles, roll again!"
          : game.pending?.type === "buy"
            ? " — buy, auction, or pass (45s)"
            : game.rolled
              ? " — resolving…"
              : " — roll the dice");

  $("actionTitle").textContent = !isLocalTurn
    ? game.multiplayer?.connected
      ? "WAITING"
      : p.bot
        ? "AI TURN"
        : "YOUR TURN"
    : game.pending?.type === "buy"
      ? "BUY OR PASS"
      : game.rolled
        ? "YOUR MOVE"
        : "YOUR TURN";

  $("actionText").textContent = game.done
    ? "Game over."
    : game.pending?.type === "buy"
      ? "Buy, auction, or pass — auto-pass in 45 seconds."
      : game.pending
        ? "Resolve the decision in the purchase panel."
        : !isLocalTurn
          ? "Other player(s) in control."
          : game.rolled
            ? "Turn advances automatically when ready."
            : "Roll from the board centre. Manage assets anytime.";
}

export function financeReportHTML(game, seat) {
  const p = game.players[seat];
  const mortgaged = p.props.filter((i) => asset(game, i).mortgaged);
  const unmortSection =
    mortgaged.length > 0
      ? `<h3 class="finance-subhead">Unmortgage (pay bank)</h3>
    <p class="small">Unmortgage cost = mortgage (85% of deed) + 5% interest. Mortgaged deeds collect no rent and are not counted as active holdings.</p>
    <div class="propertyrows finance-mort-actions">${mortgaged
      .map(
        (i) => {
          const a = asset(game, i);
          const principal = a.mortgagePrincipal > 0 ? a.mortgagePrincipal : mortgageValue(i);
          const cost = unmortgageCost(i);
          return `<div class="prow prow-mortgaged"><div><b>${BOARD[i][0]}</b>
      <div class="small">Mortgaged for <b>$${principal}</b> · pay <b>$${cost}</b> to redeem (principal + 5%)</div></div>
      <button type="button" class="primary" data-unmort="${i}">Unmortgage · pay $${cost}</button></div>`;
        }
      )
      .join("")}</div>`
      : `<p class="small">No mortgaged properties. Use <b>Manage assets</b> to mortgage deeds for cash (85% of list price).</p>`;
  const activeRows = p.props
    .filter((i) => !asset(game, i).mortgaged)
    .map((i) => {
      const a = asset(game, i);
      const r = rentAmount(game, i);
      return `<tr><td>${BOARD[i][0]}</td><td>$${BOARD[i][2]}</td><td>${a.houses || 0}</td><td>$${r}</td></tr>`;
    })
    .join("");
  return `<p>Cash <b>$${p.cash}</b> · Net worth <b>$${worth(game, p)}</b> · Active deeds <b>${activePropertyCount(game, p)}</b></p>
    <table class="finance-table"><thead><tr><th>Active property</th><th>Price</th><th>Bldg</th><th>Rent</th></tr></thead><tbody>${activeRows || '<tr><td colspan="4">No active (unmortgaged) properties</td></tr>'}</tbody></table>
    ${unmortSection}
    <p class="small">Bank houses: ${game.bank.houses} · hotels: ${game.bank.hotels}</p>`;
}

function buildingsLabel(a) {
  if (a.mortgaged) return "Mortgaged · no rent";
  if (a.houses === 5) return "🏨 Hotel";
  if (a.houses) return `🏠 ${a.houses} house${a.houses > 1 ? "s" : ""}`;
  return "No buildings";
}

function manageRentLine(game, p, i, a) {
  if (a.mortgaged) return `<span class="manage-rent">Rent: <b>$0</b> <span class="small">(mortgaged)</span></span>`;
  const rent = rentAmount(game, i);
  if (!isProperty(i)) {
    return `<span class="manage-rent">Rent if landed on: <b>$${rent}</b></span>`;
  }
  let tier = "site";
  if (a.houses === 5) tier = "hotel";
  else if (a.houses) tier = `${a.houses} house${a.houses > 1 ? "s" : ""}`;
  return `<span class="manage-rent">Rent (${tier}): <b>$${rent}</b></span>`;
}

export function manageModalHTML(game, seat) {
  const p = game.players[seat];
  const sorted = [...p.props].sort((a, b) => {
    const am = asset(game, a).mortgaged ? 0 : 1;
    const bm = asset(game, b).mortgaged ? 0 : 1;
    return am - bm || BOARD[a][0].localeCompare(BOARD[b][0]);
  });
  const rows = sorted
    .map((i) => {
      const a = asset(game, i);
      const hc = houseCostFor(i);
      const canBuild = canBuildOn(game, p, i);
      const canSell = canSellOn(game, p, i);
      const buildWhy = buildBlockReason(game, p, i);
      const sellWhy = sellBlockReason(game, p, i);
      const buildLbl =
        !isProperty(i)
          ? ""
          : a.houses === 4
            ? `Build hotel $${hc}`
            : a.houses === 5
              ? ""
              : `Build house $${hc}`;
      const sellPayout = money(hc * SELL_BUILDING_FRACTION);
      const sellLbl =
        a.houses === 5
          ? `Sell hotel $${sellPayout}`
          : a.houses
            ? `Sell house $${sellPayout}`
            : "";
      const canBankAuction = !a.mortgaged && !a.houses;
      return `<div class="prow ${a.mortgaged ? "prow-mortgaged" : ""} ${canBuild ? "prow-can-build" : ""}"><div><b>${BOARD[i][0]}</b>
      <div class="small">${buildingsLabel(a)}</div>
      ${manageRentLine(game, p, i, a)}</div><div class="actions">${
        a.mortgaged
          ? `<button type="button" class="primary" data-unmort="${i}">Unmortgage · pay $${unmortgageCost(i)}</button>`
          : `<button type="button" data-mort="${i}" ${a.houses ? "disabled" : ""} title="${
              a.houses ? "Sell all houses/hotel to the bank first (75% of build cost)" : `Bank pays 85% of $${BOARD[i][2]}`
            }">Mortgage +$${mortgageValue(i)}</button>`
      }${
        canBankAuction
          ? `<button data-bankauction="${i}" title="25% fee to bank">🏦 Bank auction</button>`
          : ""
      }${
        buildLbl
          ? `<button data-build="${i}" ${!canBuild ? "disabled" : ""} title="${buildWhy || "Add house"}">${buildLbl}</button>`
          : ""
      }${
        a.houses
          ? `<button data-sell="${i}" ${!canSell ? "disabled" : ""} title="${sellWhy || `Bank pays 75% of build cost ($${sellPayout})`}">${sellLbl}</button>`
          : ""
      }</div></div>`;
    })
    .join("");
  return rows || "You do not own properties yet.";
}

/** Animate token stepping forward from `fromPos` (player.pos must match fromPos when called). */
let rentFxLayer;

/** Fly rent from board space to owner cash (used when bots pay rent). */
export function animateRentTransfer(fromSpace, payerIdx, receiverIdx, amount, payerColor, receiverColor) {
  if (!amount) return;
  const board = $("board");
  const spaceEl = board?.querySelector(`[data-space="${fromSpace}"]`);
  const recvCash = document.querySelector(`#players .player:nth-child(${receiverIdx + 1}) .cash`);
  if (!spaceEl || !recvCash) return;

  if (!rentFxLayer) {
    rentFxLayer = document.createElement("div");
    rentFxLayer.className = "rent-fx-layer";
    rentFxLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(rentFxLayer);
  }

  const s0 = spaceEl.getBoundingClientRect();
  const s1 = recvCash.getBoundingClientRect();
  const startX = s0.left + s0.width / 2;
  const startY = s0.top + s0.height / 2;
  const dx = s1.left + s1.width / 2 - startX;
  const dy = s1.top + s1.height / 2 - startY;

  spaceEl.classList.add("rent-space-hit");
  window.setTimeout(() => spaceEl.classList.remove("rent-space-hit"), 900);

  const coin = document.createElement("div");
  coin.className = "rent-coin";
  coin.style.left = `${startX}px`;
  coin.style.top = `${startY}px`;
  coin.style.setProperty("--dx", `${dx}px`);
  coin.style.setProperty("--dy", `${dy}px`);
  coin.style.setProperty("--payer-color", payerColor || "#f5c842");
  coin.style.setProperty("--recv-color", receiverColor || "#49cb91");
  coin.innerHTML = `<span class="rent-coin-amt">$${amount}</span>`;
  rentFxLayer.appendChild(coin);

  const payerCash = document.querySelector(`#players .player:nth-child(${payerIdx + 1}) .cash`);
  payerCash?.classList.add("rent-paid-out");

  coin.addEventListener(
    "animationend",
    () => {
      coin.remove();
      recvCash.classList.add("rent-in");
      window.setTimeout(() => recvCash.classList.remove("rent-in"), 700);
      payerCash?.classList.remove("rent-paid-out");
    },
    { once: true }
  );
}

export async function animateMove(game, player, fromPos, steps, onStep) {
  if (!game.settings.animations || !steps || game._skipAnimations) {
    player.pos = (fromPos + steps) % 40;
    return;
  }
  game.animating = true;
  try {
    onStep?.();
    player.pos = fromPos;
    for (let s = 1; s <= steps; s++) {
      if (game._skipAnimations) {
        player.pos = (fromPos + steps) % 40;
        break;
      }
      player.pos = (fromPos + s) % 40;
      renderBoard(game, player.pos, player.color);
      const hop = document.querySelector(`[data-space="${player.pos}"]`);
      hop?.classList.add("token-hop");
      setTimeout(() => hop?.classList.remove("token-hop"), MOVE_MS_PER_SPACE);
      renderPlayers(game);
      await new Promise((r) => setTimeout(r, MOVE_MS_PER_SPACE));
    }
  } finally {
    game.animating = false;
    game._skipAnimations = false;
  }
}

export { $, DEFAULT_NAMES };

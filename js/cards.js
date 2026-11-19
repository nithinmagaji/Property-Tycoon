/** Chance & Community Chest card text (shared by rules engine and board UI). */

export const CHANCE_CARDS = [
  { t: "Advance to GO", action: "go", amount: 200 },
  { t: "Bank pays you dividend of $50", amount: 50 },
  { t: "Go back 3 spaces", action: "back3" },
  { t: "Go directly to Jail", action: "jail" },
  { t: "Pay poor tax of $15", amount: -15 },
  { t: "Your building loan matures — Collect $150", amount: 150 },
  { t: "You have won a crossword competition — Collect $100", amount: 100 },
  { t: "Get Out of Jail Free", action: "jailCard" },
  { t: "Make general repairs — $25/house, $100/hotel", action: "repairs" },
  { t: "Speeding fine — Pay $15", amount: -15 },
  { t: "Take a trip to Reading Railroad", action: "rail", index: 5 },
  { t: "Chairman — Pay each player $50", action: "payAll", amount: -50 },
];

export const COMMUNITY_CARDS = [
  { t: "Advance to GO — Collect $200", action: "go", amount: 200 },
  { t: "Bank error in your favour — Collect $200", amount: 200 },
  { t: "Doctor's fee — Pay $50", amount: -50 },
  { t: "From sale of stock you get $50", amount: 50 },
  { t: "Holiday Fund matures — Receive $100", amount: 100 },
  { t: "Income tax refund — Collect $20", amount: 20 },
  { t: "Life insurance matures — Collect $100", amount: 100 },
  { t: "Pay hospital fees of $100", amount: -100 },
  { t: "Pay school fees of $50", amount: -50 },
  { t: "Receive $25 consultancy fee", amount: 25 },
  { t: "Street repairs — $40/house, $100/hotel", action: "repairs", house: 40, hotel: 100 },
  { t: "Get Out of Jail Free", action: "jailCard" },
  { t: "Go to Jail", action: "jail" },
  { t: "Grand Opera — Collect $50 from each player", action: "collectAll", amount: 50 },
];

export function catalogForSpace(boardName) {
  if (boardName === "Chance") return { key: "chance", label: "Chance", cards: CHANCE_CARDS, accent: "#e8a735" };
  if (boardName === "Community Fund")
    return { key: "community", label: "Community Chest", cards: COMMUNITY_CARDS, accent: "#5cb8d6" };
  return null;
}

export function cardEffectShort(card) {
  if (card.amount > 0) return `+$${card.amount}`;
  if (card.amount < 0) return `-$${-card.amount}`;
  if (card.action === "go") return "+$200";
  if (card.action === "jail" || card.action === "jailCard") return "Jail";
  if (card.action === "back3") return "←3";
  if (card.action === "repairs") return "Repairs";
  if (card.action === "rail") return "→Rail";
  if (card.action === "payAll") return "Pay all";
  if (card.action === "collectAll") return "From all";
  return "—";
}

export function cardDrawModalHTML(deckLabel, card, accent) {
  return `<div class="card-draw-reveal" style="--card-accent:${accent}">
    <p class="card-draw-text">${card.t}</p>
    <p class="small">Effect applied: <b style="color:${accent}">${cardEffectShort(card)}</b></p>
  </div>`;
}

const DICE_TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Assign each die total 2–12 a fixed card for this match (shuffled once at game start). */
export function initDiceCardMaps(game) {
  const buildMap = (pool) => {
    const shuffled = shuffle(pool.map((c, i) => ({ ...c, _id: i })));
    const map = {};
    DICE_TOTALS.forEach((total, i) => {
      map[total] = { ...shuffled[i % shuffled.length] };
    });
    return map;
  };
  game.diceCardMaps = {
    chance: buildMap(CHANCE_CARDS),
    community: buildMap(COMMUNITY_CARDS),
  };
  game.decks = { chance: [], community: [] };
}

export function cardForDiceTotal(game, deckKey, total) {
  const t = Math.max(2, Math.min(12, total || 7));
  const map = game.diceCardMaps?.[deckKey];
  if (!map) return { ...CHANCE_CARDS[0] };
  return { ...map[t] };
}

export function cardCatalogHTML(label, cards, accent) {
  const rows = cards
    .map(
      (c, i) =>
        `<tr><td>${i + 1}</td><td>${c.t}</td><td style="color:${accent};font-weight:800">${cardEffectShort(c)}</td></tr>`
    )
    .join("");
  return `<p class="small">${label} — reference list. In play, your die <b>total</b> picks the row for this match.</p>
    <table class="finance-table card-catalog"><thead><tr><th>#</th><th>Card</th><th>Effect</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function cardCenterPanelHTML(game, boardName) {
  const cat = catalogForSpace(boardName);
  if (!cat) return "";
  const map = game.diceCardMaps?.[cat.key] || {};
  const last = game.lastDraw?.[cat.key];

  const items = DICE_TOTALS.map((total) => {
    const c = map[total] || cat.cards[0];
    const isLast = last && last.diceTotal === total;
    return `<li class="deck-card${isLast ? " deck-card-last" : ""}" title="${c.t}">
      <span class="cdnum">${total}</span>
      <span class="cdeffect" style="color:${cat.accent}">${cardEffectShort(c)}</span>
      <span class="cdtext">${c.t}</span>
    </li>`;
  }).join("");

  const lastLine = last
    ? `<p class="center-deck-last small">Last: dice ${last.diceTotal} — <b>${last.t}</b></p>`
    : "";

  return `<section class="center-deck-panel panel-${cat.key}" data-deck="${cat.key}">
    <header class="center-deck-head">
      <span class="center-deck-badge" style="background:${cat.accent}">${cat.key === "chance" ? "?" : "CC"}</span>
      <div class="center-deck-head-text">
        <div class="center-deck-title">${cat.label}</div>
        <div class="center-deck-count">Die total → fixed event this game</div>
      </div>
    </header>
    <ul class="center-deck-list center-deck-full" aria-label="${cat.label} by die total">${items}</ul>
    ${lastLine}
  </section>`;
}

export function renderCenterDecks(game) {
  const el =
    typeof document !== "undefined" ? document.getElementById("centerDecks") : null;
  if (!el) return;
  el.innerHTML =
    cardCenterPanelHTML(game, "Chance") + cardCenterPanelHTML(game, "Community Fund");
}

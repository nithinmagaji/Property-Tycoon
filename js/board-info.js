import {
  BOARD,
  groupOf,
  spaceVisual,
  spaceDisplayName,
  RENT_TABLE,
  minimumRentForIndex,
  MIN_RENT_FRACTION,
  BUILDING_RENT_FRACTIONS,
  MORTGAGE_FRACTION,
  UNMORTGAGE_INTEREST,
} from "./data.js";
import { mortgageValue, unmortgageCost } from "./engine.js";

const RAIL_RENTS = [25, 50, 100, 200];
const UTIL_NOTE = "4× dice (one utility) or 10× dice (both)";

export function propertyFacts(spaceIndex) {
  const g = BOARD[spaceIndex];
  const vis = spaceVisual(spaceIndex);
  const lines = [];
  if (g[2] > 0) lines.push({ k: "List price", v: `$${g[2]}` });
  if (g[3]) {
    const min = minimumRentForIndex(spaceIndex);
    lines.push({
      k: "Rent (no buildings)",
      v: `$${Math.max(g[3], min)} minimum (${MIN_RENT_FRACTION * 100}% of $${g[2]})`,
    });
  }

  const key = g[4];
  if (key === "rail") {
    lines.push({ k: "Type", v: "Railroad" });
    lines.push({ k: "Rent scale", v: RAIL_RENTS.map((r) => `$${r}`).join(" · ") });
  } else if (key === "util") {
    lines.push({ k: "Type", v: "Utility" });
    lines.push({ k: "Rent rule", v: UTIL_NOTE });
  } else if (key && RENT_TABLE[key]) {
    const rents = RENT_TABLE[key];
    lines.push({ k: "Type", v: "Property (" + key + " set)" });
    lines.push({ k: "Set rent (no houses)", v: `$${rents[0]} → $${rents[0] * 2} with full set` });
    const price = g[2];
    lines.push({
      k: "Building rent",
      v: `1h ${BUILDING_RENT_FRACTIONS[1] * 100}% ($${Math.round(price * BUILDING_RENT_FRACTIONS[1])}) · 2h ${
        BUILDING_RENT_FRACTIONS[2] * 100
      }% · 3h ${BUILDING_RENT_FRACTIONS[3] * 100}% · hotel ${BUILDING_RENT_FRACTIONS[5] * 100}%`,
    });
    lines.push({
      k: "Mortgage",
      v: `${MORTGAGE_FRACTION * 100}% to bank ($${mortgageValue(spaceIndex)}); unmortgage +${UNMORTGAGE_INTEREST * 100}% ($${unmortgageCost(spaceIndex)})`,
    });
    const gr = groupOf(spaceIndex);
    if (gr) {
      const names = gr[1].map((i) => BOARD[i][0]).join(", ");
      lines.push({ k: "Colour group", v: names });
    }
  }

  return { name: spaceDisplayName(spaceIndex), vis, lines };
}

export function propertyDetailHTML(spaceIndex, compact = false) {
  const { name, vis, lines } = propertyFacts(spaceIndex);
  const g = BOARD[spaceIndex];
  const band = g[1] ? `<div class="auction-band" style="background:${g[1]}"></div>` : "";
  const rows = lines.map((x) => `<li><span>${x.k}</span><b>${x.v}</b></li>`).join("");
  const cls = compact ? "auction-property-card compact" : "auction-property-card";
  return `<div class="${cls}">
    ${band}
    <div class="auction-property-head">
      <div class="purchase-thumb auction-thumb"><svg viewBox="0 0 64 64"><use href="#${vis.sprite}"></use></svg></div>
      <div><h3 class="auction-property-name">${name}</h3><p class="small">List $${g[2] || "—"}</p></div>
    </div>
    <ul class="auction-facts">${rows}</ul>
  </div>`;
}

export function auctionPropertyHTML(spaceIndex) {
  const { name, vis, lines } = propertyFacts(spaceIndex);
  const g = BOARD[spaceIndex];
  const band = g[1]
    ? `<div class="auction-band" style="background:${g[1]}"></div>`
    : "";
  const rows = lines.map((x) => `<li><span>${x.k}</span><b>${x.v}</b></li>`).join("");
  return `<div class="auction-property-card">
    ${band}
    <div class="auction-property-head">
      <div class="purchase-thumb auction-thumb"><svg viewBox="0 0 64 64"><use href="#${vis.sprite}"></use></svg></div>
      <div><h3 class="auction-property-name">${name}</h3><p class="small">Unowned — open bidding</p></div>
    </div>
    <ul class="auction-facts">${rows}</ul>
  </div>`;
}

/** Live high-bid summary for modal + sidebar during an auction. */
export function auctionBidStatusHTML(game) {
  const a = game.auction;
  if (!a) return "";
  const prop = BOARD[a.space][0];
  const bidder = game.players[a.current];
  const minBid = a.bid + 1;

  if (a.leader === null) {
    return `<div class="auction-bid-status no-bid">
      <div class="auction-bid-label">Current high bid</div>
      <div class="auction-bid-amount">$${a.bid} <span class="auction-bid-none">(none yet)</span></div>
      <p class="small">Open bidding on <b>${prop}</b>. Minimum opening bid: <b>$${minBid || 1}</b>.</p>
      <p class="small">Now bidding: <b>${bidder.name}</b></p>
    </div>`;
  }

  const leader = game.players[a.leader];
  const av = leader.avatar || "🎮";
  const sameTurn = a.current === a.leader;
  return `<div class="auction-bid-status has-bid">
    <div class="auction-bid-label">Current high bid</div>
    <div class="auction-bid-amount">$${a.bid}</div>
    <div class="auction-bid-leader">
      <span class="board-token sm" style="--token-ring:${leader.color}"><span class="board-token-emoji">${av}</span></span>
      <span>Held by <b>${leader.name}</b> at <b>$${a.bid}</b></span>
    </div>
    <p class="small">${sameTurn ? `${leader.name} holds the lead — other players may raise.` : `Next bid must be at least <b>$${minBid}</b>.`}</p>
    <p class="small">Now bidding: <b>${bidder.name}</b>${bidder.bot ? " (AI)" : ""}</p>
  </div>`;
}

/** Pawn / UI colours — kept distinct from property colour bands on the board */
export const PLAYER_COLORS = ["#ff4d6d", "#2ee59d", "#ffb020", "#c77dff"];
export const DEFAULT_NAMES = ["Player 1", "Atlas", "Nova", "Pixel"];
export const BOT_ROSTER = [
  { name: "Atlas", personality: "builder", avatar: "🏛️" },
  { name: "Nova", personality: "balanced", avatar: "🚀" },
  { name: "Pixel", personality: "trader", avatar: "🎨" },
];
export const AVATARS = ["🎩", "🚀", "🏛️", "🎨", "🦊", "🐼", "⚡", "👑"];

/** [name, color, price, baseRent, groupKey] — groupKey for building costs */
export const BOARD = [
  ["GO", null, 0, 0, null],
  ["Old Town", "#987456", 60, 2, "brown"],
  ["Community Fund", null, 0, 0, null],
  ["Maple Street", "#987456", 60, 4, "brown"],
  ["Income Tax", null, 0, 0, null],
  ["Central Station", null, 200, 25, "rail"],
  ["Garden Lane", "#df8b9b", 100, 6, "light"],
  ["Chance", null, 0, 0, null],
  ["Market Square", "#df8b9b", 100, 6, "light"],
  ["Harbour View", "#df8b9b", 120, 8, "light"],
  ["JAIL", null, 0, 0, null],
  ["Cedar Avenue", "#e99051", 140, 10, "pink"],
  ["Electric Works", null, 150, 0, "util"],
  ["Pine Street", "#e99051", 140, 10, "pink"],
  ["Hillcrest", "#e99051", 160, 12, "pink"],
  ["West Station", null, 200, 25, "rail"],
  ["Lake Drive", "#e8c65d", 180, 14, "orange"],
  ["Community Fund", null, 0, 0, null],
  ["Sunset Boulevard", "#e8c65d", 180, 14, "orange"],
  ["Grand Avenue", "#e8c65d", 200, 16, "orange"],
  ["FREE PARKING", null, 0, 0, null],
  ["Orchard Road", "#78b9a1", 220, 18, "red"],
  ["Chance", null, 0, 0, null],
  ["Palm Avenue", "#78b9a1", 220, 18, "red"],
  ["Skyline Plaza", "#78b9a1", 240, 20, "red"],
  ["North Station", null, 200, 25, "rail"],
  ["Museum Mile", "#76a9df", 260, 22, "yellow"],
  ["Broadway", "#76a9df", 260, 22, "yellow"],
  ["Water Works", null, 150, 0, "util"],
  ["Crown Street", "#76a9df", 280, 24, "yellow"],
  ["GO TO JAIL", null, 0, 0, null],
  ["Empire Avenue", "#8e83c9", 300, 26, "green"],
  ["Kingsway", "#8e83c9", 300, 26, "green"],
  ["Community Fund", null, 0, 0, null],
  ["Royal Gardens", "#8e83c9", 320, 28, "green"],
  ["South Station", null, 200, 25, "rail"],
  ["Chance", null, 0, 0, null],
  ["Diamond Row", "#4c9c91", 350, 35, "blue"],
  ["Luxury Tax", null, 0, 0, null],
  ["The Crown", "#4c9c91", 400, 50, "blue"],
];

export const COORDS = (() => {
  const a = [];
  for (let c = 10; c >= 0; c--) a.push([10, c]);
  for (let r = 9; r >= 0; r--) a.push([r, 0]);
  for (let c = 1; c <= 10; c++) a.push([0, c]);
  for (let r = 1; r <= 9; r++) a.push([r, 10]);
  return a;
})();

export const COLOR_GROUPS = [
  ["#987456", [1, 3]],
  ["#df8b9b", [6, 8, 9]],
  ["#e99051", [11, 13, 14]],
  ["#e8c65d", [16, 18, 19]],
  ["#78b9a1", [21, 23, 24]],
  ["#76a9df", [26, 27, 29]],
  ["#8e83c9", [31, 32, 34]],
  ["#4c9c91", [37, 39]],
];

export const RAIL_INDICES = [5, 15, 25, 35];
export const UTIL_INDICES = [12, 28];

/** All cash amounts are whole dollars. */
export function money(n) {
  return Math.round(Number(n) || 0);
}

export const MORTGAGE_FRACTION = 0.85;
export const UNMORTGAGE_INTEREST = 0.05;
export const SELL_BUILDING_FRACTION = 0.75;
export const MORTGAGE_FORECLOSURE_ROUNDS = 5;
export const PROPERTY_PRICE_MIN = 100;
export const PROPERTY_PRICE_MAX = 500;
export const PURCHASE_DECISION_SECONDS = 45;

/** Rent as fraction of list price: 1h, 2h, 3h, 4h, hotel */
export const BUILDING_RENT_FRACTIONS = {
  1: 0.25,
  2: 0.35,
  3: 0.45,
  4: 0.5,
  5: 0.55,
};

/** Official-style rent multipliers: 0=site, 1h, 2h, 3h, 4h, hotel */
export const RENT_TABLE = {
  brown: [2, 10, 30, 90, 160, 250],
  light: [4, 20, 60, 180, 320, 450],
  pink: [6, 30, 90, 270, 400, 550],
  orange: [8, 40, 100, 300, 450, 600],
  red: [10, 50, 150, 450, 625, 750],
  yellow: [12, 60, 180, 500, 700, 900],
  green: [14, 70, 200, 550, 750, 950],
  blue: [16, 80, 220, 600, 800, 1000],
};

/** Minimum site rent = 10% of property price (Monopoly-style building still applies). */
export const MIN_RENT_FRACTION = 0.1;

export function minimumRentForIndex(i) {
  const price = BOARD[i][2];
  return price > 0 ? money(price * MIN_RENT_FRACTION) : 0;
}

export const HOUSE_COST = {
  brown: 50,
  light: 50,
  pink: 100,
  orange: 100,
  red: 150,
  yellow: 150,
  green: 200,
  blue: 200,
};

export const JAIL_INDEX = 10;
export const GO_INDEX = 0;
export const GO_TO_JAIL = 30;
export const INCOME_TAX = 4;
export const LUXURY_TAX = 38;
export const FREE_PARKING = 20;

export function groupOf(index) {
  return COLOR_GROUPS.find((x) => x[1].includes(index));
}

export function groupKey(index) {
  const g = BOARD[index];
  return g[4];
}

export function isProperty(index) {
  const g = BOARD[index];
  return g[2] > 0 && g[4] && !["rail", "util"].includes(g[4]);
}

(function applyRentFloors() {
  for (let i = 0; i < BOARD.length; i++) {
    if (isProperty(i)) BOARD[i][3] = minimumRentForIndex(i);
  }
  for (const key of Object.keys(RENT_TABLE)) {
    const indices = BOARD.map((g, idx) => (g[4] === key ? idx : -1)).filter((idx) => idx >= 0);
    if (!indices.length) continue;
    const old = RENT_TABLE[key];
    const newBase = Math.min(...indices.map((i) => minimumRentForIndex(i)));
    const factor = old[0] > 0 ? newBase / old[0] : 1;
    RENT_TABLE[key] = old.map((r, hi) => (hi === 0 ? newBase : money(r * factor)));
  }
})();

(function scaleBoardListPrices() {
  const propIdx = [];
  for (let i = 0; i < BOARD.length; i++) {
    const g = BOARD[i];
    if (g[2] > 0 && g[4] && ["rail", "util"].includes(g[4]) === false && g[4] !== null) {
      if (isProperty(i)) propIdx.push(i);
    }
  }
  if (!propIdx.length) return;
  const prices = propIdx.map((i) => BOARD[i][2]);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = maxP - minP || 1;
  for (let i = 0; i < BOARD.length; i++) {
    const g = BOARD[i];
    if (g[2] <= 0) continue;
    if (!g[4] || g[4] === null) continue;
    const p = g[2];
    const np =
      isProperty(i) || g[4] === "rail" || g[4] === "util"
        ? money(PROPERTY_PRICE_MIN + ((p - minP) * (PROPERTY_PRICE_MAX - PROPERTY_PRICE_MIN)) / span)
        : p;
    BOARD[i][2] = np;
    if (isProperty(i)) BOARD[i][3] = minimumRentForIndex(i);
  }
  const houseScale = PROPERTY_PRICE_MIN / (minP || 60);
  for (const key of Object.keys(HOUSE_COST)) {
    HOUSE_COST[key] = money(HOUSE_COST[key] * houseScale);
  }
})();

const GROUP_SCENE = {
  brown: "property",
  light: "property",
  pink: "property",
  orange: "property",
  red: "property",
  yellow: "property",
  green: "property",
  blue: "luxury",
};

/** Visual metadata for board spaces (sprite id + layout class). */
export function spaceDisplayName(index) {
  const name = BOARD[index][0];
  if (name === "Community Fund") return "Community Chest";
  return name;
}

export function spaceVisual(index) {
  const g = BOARD[index];
  const name = g[0];
  if (index === GO_INDEX) return { sprite: "go", type: "corner", scene: "go" };
  if (index === JAIL_INDEX) return { sprite: "jail", type: "corner", scene: "jail" };
  if (index === FREE_PARKING) return { sprite: "parking", type: "corner", scene: "parking" };
  if (index === GO_TO_JAIL) return { sprite: "gotojail", type: "corner", scene: "gotojail" };
  if (name === "Chance") return { sprite: "chance", type: "card", scene: "chance" };
  if (name === "Community Fund") return { sprite: "community", type: "card", scene: "community" };
  if (index === INCOME_TAX || index === LUXURY_TAX) return { sprite: "tax", type: "tax", scene: "tax" };
  if (g[4] === "rail") return { sprite: "rail", type: "rail", scene: "rail" };
  if (g[4] === "util") return { sprite: "util", type: "util", scene: "util" };
  if (g[4] === "blue" && g[2] >= 350) return { sprite: "luxury", type: "premium", scene: "luxury" };
  return { sprite: GROUP_SCENE[g[4]] || "property", type: "property", scene: g[4] || "property" };
}

export function freshGame(settings = {}) {
  const names = settings.playerNames || DEFAULT_NAMES.slice();
  const bots = settings.bots ?? [false, true, true, true];
  return {
    version: 3,
    players: names.map((name, i) => ({
      id: i,
      name,
      color: PLAYER_COLORS[i],
      avatar: AVATARS[i % AVATARS.length],
      cash: settings.startingCash ?? 1500,
      pos: 0,
      props: [],
      jail: 0,
      jailTurns: 0,
      bankrupt: false,
      bot: bots[i],
      personality: ["human", "builder", "balanced", "trader"][i] || "balanced",
      getOutCards: 0,
      turns: 0,
      doublesInRow: 0,
      inactive: false,
    })),
    assets: {},
    bank: { houses: 32, hotels: 12 },
    turn: 0,
    rolled: false,
    mustRollAgain: false,
    done: false,
    round: 1,
    pot: 0,
    log: [],
    stats: {
      rolls: 0,
      buys: 0,
      auctions: 0,
      trades: 0,
      builds: 0,
      mortgages: 0,
      rent: 0,
      taxes: 0,
      bankruptcies: 0,
    },
    settings: {
      difficulty: settings.difficulty ?? "normal",
      startingCash: settings.startingCash ?? 1500,
      animations: settings.animations !== false,
      sound: settings.sound !== false,
      auction: settings.auction !== false,
      freeParking: settings.freeParking !== false,
      officialRules: true,
      theme: settings.theme ?? "classic",
      country: settings.country ?? "USA",
      hotseat: settings.hotseat ?? false,
      turnSeconds: settings.turnSeconds ?? 60,
      playerNames: settings.playerNames || names.slice(),
      playerCount: settings.playerCount ?? 4,
    },
    market: { staleRounds: 0, buysSinceCheck: false },
    undoStack: [],
    lastRoll: null,
    lastDice: [1, 1],
    auction: null,
    pending: null,
    incomeTaxChoice: null,
    history: [],
    multiplayer: null,
    animating: false,
    paused: false,
    decks: { chance: null, community: null },
    lastDraw: {},
  };
}

// Dominican-style dominó, double-six set, 7 tiles each.
//   2v2 — partners across the table (seats 0+2 vs 1+3), no boneyard.
//   1v1 — two players; the other 14 tiles are the pile you draw from ("robar").
//   ffa — four players, everyone for themselves, no boneyard.
// Arcade (rules.ruleset = 'arcade', 2v2 only): each hand won is a star, three
// stars win, and players earn powers as they play (up to two held) —
// Cambio, Doble golpe, Comodín and Candado (see the Arcade section below).
// Pure functions only — this file must stay free of DOM/React so the server
// runs the exact same rules as the browser.

export type Tile = [number, number]; // normalized: tile[0] <= tile[1]
export type Seat = 0 | 1 | 2 | 3;
export type Side = 'L' | 'R';
export type Mode = '1v1' | '2v2' | 'ffa';
export type Ruleset = 'traditional' | 'arcade';
export type Power = 'cambio' | 'doble' | 'comodin' | 'candado';

/** A tile on the table, oriented left→right: `a` faces the left end, `b` the right end. */
export interface Placed {
  a: number;
  b: number;
  seat: Seat;
  /** Arcade Comodín: which half was changed to connect (a/b are then the values in play)… */
  wild?: 'a' | 'b';
  /** …and the physical ficha it really is. */
  phys?: Tile;
}

export type Move =
  /** `lock` = Candado: after this play, that end of the board is closed for the next player. */
  | { type: 'play'; tile: Tile; side: Side; lock?: Side; callPass?: boolean }
  | { type: 'pass' }
  | { type: 'draw' }
  /** Give one of my fichas for a random one of an opponent's. My turn goes on. */
  | { type: 'cambio'; tile: Tile; target: Seat }
  /** Two placements in one turn, checked and applied together. */
  | { type: 'doble'; first: { tile: Tile; side: Side }; second: { tile: Tile; side: Side } }
  /** Play `tile` at `side`, its `half` (0 = tile[0], 1 = tile[1]) turned into the number that end needs. */
  | { type: 'comodin'; tile: Tile; side: Side; half: 0 | 1 };

export type GameEvent =
  | { kind: 'play'; seat: Seat; tile: Tile; side: Side }
  | { kind: 'pass'; seat: Seat }
  | { kind: 'draw'; seat: Seat }
  | { kind: 'paseCorrido'; seat: Seat; points: number }
  /** The player right after a hand's first tile couldn't follow it; `seat` opened (their side scores). */
  | { kind: 'paseSalida'; seat: Seat; points: number }
  /** An Arcade power. Never carries the values of fichas that change hands. */
  | { kind: 'power'; seat: Seat; power: Power; target?: Seat; side?: Side; tile?: Tile; from?: number; to?: number }
  /** Arcade: a power earned — `block` (my play left the next rival without a play) or `comeback` (my team lost a hand). */
  | { kind: 'earn'; seat: Seat; reason: 'block' | 'comeback' }
  | { kind: 'callPass'; seat: Seat; target: Seat }
  | { kind: 'callPassResult'; seat: Seat; target: Seat; success: boolean; gained: number };

export interface HandResult {
  kind: 'domino' | 'tranque';
  winnerSeat: Seat;
  /** Scoring side (team in 2v2, the player in 1v1/ffa). */
  side: number;
  /** Pips the winners score (Arcade: the star, 1). */
  points: number;
  capicua: boolean;
  bonus: number;
  total: number;
  counts: number[];
  hands: Tile[][];
  /** Tranque tied across sides; broken in favor of la mano. */
  tieToMano: boolean;
}

export interface Rules {
  mode: Mode;
  /** Points to win (Arcade: stars, 3). */
  target: number;
  capicuaBonus: number;
  paseCorridoBonus: number;
  /** Pase de salida (2v2): the next player can't follow a hand's first tile. Missing on older tables = off. */
  paseSalidaBonus?: number;
  /** Missing on everything created before Arcade existed: those are traditional. */
  ruleset?: Ruleset;
}

/** Points for a pase de salida, where it's played (2v2 only). */
export const PASE_SALIDA = 30;

export const CLASSIC_DR: Rules = { mode: '2v2', target: 200, capicuaBonus: 25, paseCorridoBonus: 25, paseSalidaBonus: PASE_SALIDA };

/** Arcade's public, per-match power state. */
export interface ArcadeState {
  /** Powers each seat holds right now (earned during the match, at most two). */
  charges: number[];
  /** A board end closed for one player's turn (Candado). */
  lock: { side: Side; seat: Seat } | null;
  /** The player whose turn it is already used a power this turn. */
  powerUsed: boolean;
  /** Consecutive unrestricted passes; four in a row block the hand. */
  passes: number;
  /** One Call the Pass per seat per hand. Older saved games may omit this. */
  callUsed?: boolean[];
  /** The rival whose current turn will settle the call. */
  call?: { caller: Seat; target: Seat } | null;
  /** Recent online action ids, so a retried request is never applied twice (server only). */
  recent?: string[];
}

export interface GameState {
  rules: Rules;
  scores: number[];
  handNo: number;
  hands: Tile[][];
  /** Face-down tiles left to draw (1v1 only). */
  boneyard: Tile[];
  line: Placed[];
  /** Index in `line` of the first tile played this hand (the center of the snake). */
  origin: number;
  mano: Seat;
  turn: Seat;
  lastPlayer: Seat | null;
  passesSinceLastPlay: number;
  /** The tile the first hand must open with (doble seis, or the highest double in 1v1). */
  mustOpen: Tile | null;
  /** Public info: numbers each seat has shown it doesn't hold (by passing). */
  voids: number[][];
  events: GameEvent[];
  handResult: HandResult | null;
  /** Winning side, once someone reaches the target. */
  winner: number | null;
  /** Whole-game counts per side (side bets and profile stats read these). */
  tally: Tally;
  /** Whole-game counts per player: who is carrying the game. Missing on games started before it existed. */
  seatStats?: SeatStats;
  /** Online, between hands: the seats that tapped "Listo" for the next one. */
  nextReady?: Seat[];
  /** Arcade only. */
  arcade?: ArcadeState;
}

export interface Tally {
  capicuas: number[];
  tranques: number[];
  hands: number[];
}

/** Per player, for the whole game (index = seat). */
export interface SeatStats {
  /** Points this player won for their side: hands they closed, plus pase corrido / de salida. Arcade: stars. */
  points: number[];
  /** Hands they won by playing their last tile. */
  dominoes: number[];
  capicuas: number[];
  /** Tiles they laid on the board. */
  tiles: number[];
  passes: number[];
}

export const emptySeatStats = (mode: Mode): SeatStats => {
  const zeros = () => new Array(playerCount(mode)).fill(0);
  return { points: zeros(), dominoes: zeros(), capicuas: zeros(), tiles: zeros(), passes: zeros() };
};

function stat(s: GameState, key: keyof SeatStats, seat: Seat, by = 1) {
  s.seatStats ??= emptySeatStats(s.rules.mode);
  s.seatStats[key][seat] += by;
}

const emptyTally = (mode: Mode): Tally => ({
  capicuas: new Array(sideCount(mode)).fill(0),
  tranques: new Array(sideCount(mode)).fill(0),
  hands: new Array(sideCount(mode)).fill(0),
});

export type Rng = () => number;

export const playerCount = (mode: Mode) => (mode === '1v1' ? 2 : 4);
export const sideCount = (mode: Mode) => (mode === '2v2' ? 2 : playerCount(mode));
export const sideOf = (mode: Mode, seat: number) => (mode === '2v2' ? seat % 2 : seat);
export const seatsOf = (mode: Mode) => Array.from({ length: playerCount(mode) }, (_, i) => i as Seat);
export const nextSeat = (state: Pick<GameState, 'rules'>, seat: Seat): Seat => ((seat + 1) % playerCount(state.rules.mode)) as Seat;
export const pips = (t: Tile) => t[0] + t[1];
export const isDouble = (t: Tile) => t[0] === t[1];
export const sameTile = (x: Tile, y: Tile) => x[0] === y[0] && x[1] === y[1];
export const handCount = (hand: Tile[]) => hand.reduce((s, t) => s + pips(t), 0);
export const normalize = (a: number, b: number): Tile => (a <= b ? [a, b] : [b, a]);
/** The physical ficha a placed tile really is (a Comodín keeps its original numbers). */
export const physOf = (p: Placed): Tile => p.phys ?? normalize(p.a, p.b);
export const isArcade = (r: Pick<Rules, 'ruleset'>) => r.ruleset === 'arcade';
const byValue = (x: Tile, y: Tile) => x[0] - y[0] || x[1] - y[1];

export function fullSet(): Tile[] {
  const set: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]);
  return set;
}

export function deal(mode: Mode, rng: Rng = Math.random): { hands: Tile[][]; boneyard: Tile[] } {
  const set = fullSet();
  for (let i = set.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [set[i], set[j]] = [set[j], set[i]];
  }
  const n = playerCount(mode);
  const hands = Array.from({ length: n }, (_, s) => set.slice(s * 7, s * 7 + 7).sort(byValue));
  return { hands, boneyard: set.slice(n * 7) };
}

export function ends(state: Pick<GameState, 'line'>): [number, number] | null {
  if (state.line.length === 0) return null;
  return [state.line[0].a, state.line[state.line.length - 1].b];
}

/**
 * Who opens the first hand, and with what: the doble seis in 2v2/ffa (all 28
 * tiles are dealt). In 1v1 the 6-6 may be in the pile, so the highest double
 * in either hand opens — or the heaviest tile if nobody has a double.
 */
function firstOpener(hands: Tile[][]): { seat: Seat; tile: Tile } {
  let best = { seat: 0 as Seat, tile: hands[0][0], rank: -1 };
  for (let seat = 0; seat < hands.length; seat++) {
    for (const tile of hands[seat]) {
      const rank = isDouble(tile) ? 100 + tile[0] : pips(tile) + tile[1] / 10;
      if (rank > best.rank) best = { seat: seat as Seat, tile, rank };
    }
  }
  return best;
}

function startHand(prev: Pick<GameState, 'rules' | 'scores' | 'handNo' | 'tally' | 'arcade' | 'seatStats'>, rng: Rng, mano: Seat | null): GameState {
  const { hands, boneyard } = deal(prev.rules.mode, rng);
  let mustOpen: Tile | null = null;
  if (mano === null) {
    const opener = firstOpener(hands);
    mano = opener.seat;
    mustOpen = opener.tile;
  }
  const state: GameState = {
    rules: prev.rules,
    scores: [...prev.scores],
    handNo: prev.handNo + 1,
    hands,
    boneyard,
    line: [],
    origin: 0,
    mano,
    turn: mano,
    lastPlayer: null,
    passesSinceLastPlay: 0,
    mustOpen,
    voids: hands.map(() => []),
    events: [],
    handResult: null,
    winner: null,
    tally: structuredClone(prev.tally),
    seatStats: structuredClone(prev.seatStats ?? emptySeatStats(prev.rules.mode)),
  };
  if (isArcade(prev.rules)) {
    // Charges last the whole match; everything that belongs to a turn starts fresh.
    const charges = prev.arcade?.charges ?? new Array(playerCount(prev.rules.mode)).fill(ARCADE.startCharges);
    state.arcade = { charges: [...charges], lock: null, powerUsed: false, passes: 0,
      callUsed: new Array(playerCount(prev.rules.mode)).fill(false), call: null, recent: prev.arcade?.recent };
  }
  return state;
}

export function newGame(rng: Rng = Math.random, rules: Rules = CLASSIC_DR): GameState {
  return startHand({ rules, scores: new Array(sideCount(rules.mode)).fill(0), handNo: 0, tally: emptyTally(rules.mode) }, rng, null);
}

/** Next hand: whoever won the previous hand starts, with any tile. */
export function nextHand(state: GameState, rng: Rng = Math.random): GameState {
  if (!state.handResult) throw new Error('Hand still in progress');
  if (state.winner !== null) throw new Error('Game is over');
  return startHand(state, rng, state.handResult.winnerSeat);
}

const fits = (tile: Tile, n: number) => tile[0] === n || tile[1] === n;

/** The end closed for this seat's turn by a Candado, if any. */
export const lockedFor = (state: Pick<GameState, 'arcade'>, seat: Seat): Side | null =>
  state.arcade?.lock?.seat === seat ? state.arcade.lock.side : null;

/** Tile plays available to a seat (never includes draw/pass — see `forcedMove`). */
export function legalMoves(state: GameState, seat: Seat): Move[] {
  const hand = state.hands[seat];
  const e = ends(state);
  if (!e) {
    if (state.mustOpen) {
      const t = hand.find((x) => sameTile(x, state.mustOpen!));
      return t ? [{ type: 'play', tile: t, side: 'R' }] : [];
    }
    return hand.map((tile) => ({ type: 'play', tile, side: 'R' }) as Move);
  }
  const [l, r] = e;
  const locked = lockedFor(state, seat);
  const moves: Move[] = [];
  for (const tile of hand) {
    const fitsL = locked !== 'L' && fits(tile, l);
    const fitsR = locked !== 'R' && fits(tile, r);
    if (fitsL) moves.push({ type: 'play', tile, side: 'L' });
    // Same number on both ends: either side gives the same table, offer one (unless one is locked).
    if (fitsR && !(fitsL && l === r)) moves.push({ type: 'play', tile, side: 'R' });
  }
  return moves;
}

/** With nothing to play you must draw (1v1, while the pile lasts) or pass. */
export function forcedMove(state: GameState, seat: Seat): Move | null {
  if (legalMoves(state, seat).length > 0) return null;
  return state.boneyard.length > 0 ? { type: 'draw' } : { type: 'pass' };
}

export const canPlay = (state: GameState, seat: Seat) => legalMoves(state, seat).length > 0;

function isLegal(state: GameState, seat: Seat, move: Move): boolean {
  if (move.type === 'pass' || move.type === 'draw') return forcedMove(state, seat)?.type === move.type;
  if (move.type !== 'play') return false;
  return legalMoves(state, seat).some((m) => m.type === 'play' && m.side === move.side && sameTile(m.tile, move.tile));
}

/** Nobody can ever play again: no tile in any hand or the pile matches either end. */
function isBlocked(s: GameState): boolean {
  const e = ends(s)!;
  const matches = (t: Tile) => fits(t, e[0]) || fits(t, e[1]);
  return !s.hands.some((h) => h.some(matches)) && !s.boneyard.some(matches);
}

/**
 * Put a physical tile on an end of a line (a new array; the old one is not
 * touched). `wildHalf` is the Comodín: that half of the tile takes the end's
 * number, the other half faces out.
 */
export function placeOnLine(line: Placed[], origin: number, seat: Seat, tile: Tile, side: Side, wildHalf?: 0 | 1): { line: Placed[]; origin: number } {
  const e = ends({ line });
  if (!e) return { line: [{ a: tile[0], b: tile[1], seat }], origin: 0 };
  const endValue = side === 'L' ? e[0] : e[1];
  if (wildHalf !== undefined) {
    const out = tile[1 - wildHalf];
    const phys = normalize(tile[0], tile[1]);
    return side === 'L'
      ? { line: [{ a: out, b: endValue, seat, wild: 'b', phys }, ...line], origin: origin + 1 }
      : { line: [...line, { a: endValue, b: out, seat, wild: 'a', phys }], origin };
  }
  const other = tile[0] === endValue ? tile[1] : tile[0];
  return side === 'L'
    ? { line: [{ a: other, b: endValue, seat }, ...line], origin: origin + 1 }
    : { line: [...line, { a: endValue, b: other, seat }], origin };
}

/** Lay a tile from `seat`'s hand (already checked), without ending the turn. */
function lay(s: GameState, seat: Seat, tile: Tile, side: Side, wildHalf?: 0 | 1) {
  const placed = placeOnLine(s.line, s.origin, seat, tile, side, wildHalf);
  s.line = placed.line;
  s.origin = placed.origin;
  s.hands[seat] = s.hands[seat].filter((t) => !sameTile(t, tile));
  s.mustOpen = null;
  s.lastPlayer = seat;
  s.passesSinceLastPlay = 0;
  s.events.push({ kind: 'play', seat, tile: normalize(tile[0], tile[1]), side });
  stat(s, 'tiles', seat);
  if (s.arcade) s.arcade.passes = 0;
}

/** The turn moves on: the lock on this player expires and the next player starts fresh. */
function resolveCall(s: GameState, seat: Seat, passed: boolean) {
  const call = s.arcade?.call;
  if (!call || call.target !== seat) return;
  let gained = 0;
  if (passed) {
    gained = Math.min(2, ARCADE.maxCharges - s.arcade!.charges[call.caller]);
    s.arcade!.charges[call.caller] += gained;
  }
  s.events.push({ kind: 'callPassResult', seat: call.caller, target: seat, success: passed, gained });
  s.arcade!.call = null;
}

function endTurn(s: GameState, seat: Seat, passed = false) {
  if (s.arcade) {
    resolveCall(s, seat, passed);
    if (s.arcade.lock?.seat === seat) s.arcade.lock = null;
    s.arcade.powerUsed = false;
  }
  s.turn = nextSeat(s, seat);
}

export function applyMove(prev: GameState, move: Move, rng: Rng = Math.random): GameState {
  if (prev.handResult) throw new Error('Hand is over');
  const seat = prev.turn;
  if (move.type === 'play' && move.callPass) {
    const block = callPassBlock(prev, seat);
    if (block) throw new Error(`Call the Pass not available: ${block}`);
    if (move.lock) throw new Error('Call the Pass cannot be combined with Candado');
  }
  if (move.type === 'cambio' || move.type === 'doble' || move.type === 'comodin' || (move.type === 'play' && move.lock)) {
    return applyPower(prev, seat, move, rng);
  }
  if (!isLegal(prev, seat, move)) throw new Error(`Illegal move for seat ${seat}: ${JSON.stringify(move)}`);
  const s: GameState = structuredClone(prev);
  const mode = s.rules.mode;

  if (move.type === 'draw') {
    const tile = s.boneyard.shift()!;
    s.hands[seat] = [...s.hands[seat], tile].sort(byValue);
    s.events.push({ kind: 'draw', seat });
    return s; // same player keeps drawing until they can play
  }

  if (move.type === 'pass') {
    const e = ends(s)!;
    const locked = lockedFor(s, seat);
    const rightAfterAPlay = s.passesSinceLastPlay === 0;
    // A player who passed on a locked turn only showed they lack the open end.
    const shown = locked ? [locked === 'L' ? e[1] : e[0]] : e;
    for (const n of shown) if (!s.voids[seat].includes(n)) s.voids[seat].push(n);
    s.passesSinceLastPlay++;
    s.events.push({ kind: 'pass', seat });
    stat(s, 'passes', seat);
    if (s.arcade) {
      // The player whose placement left this one without a play earns a power
      // (not when a Candado did it: that power already had its effect).
      const before = ((seat + playerCount(mode) - 1) % playerCount(mode)) as Seat;
      if (!locked && rightAfterAPlay && s.lastPlayer === before && s.arcade.call?.target !== seat) earn(s, before, 'block');
      // A pass while locked out doesn't count towards a blocked hand: that player gets another go with both ends open.
      s.arcade.passes = locked ? 0 : s.arcade.passes + 1;
      endTurn(s, seat, true);
      if (s.arcade.passes >= ARCADE.passesToBlock) return finishTranque(s);
      return s;
    }
    // Pase de salida: the first player after the hand's opening tile can't follow it.
    const salida = s.rules.paseSalidaBonus ?? 0;
    if (salida > 0 && s.line.length === 1 && s.passesSinceLastPlay === 1 && s.lastPlayer !== null) {
      s.scores[sideOf(mode, s.lastPlayer)] += salida;
      stat(s, 'points', s.lastPlayer, salida);
      s.events.push({ kind: 'paseSalida', seat: s.lastPlayer, points: salida });
    }
    s.turn = nextSeat(s, seat);
    // Everyone else passed and it's back to the player who last played.
    if (s.passesSinceLastPlay === playerCount(mode) - 1 && s.turn === s.lastPlayer) {
      const points = s.rules.paseCorridoBonus;
      s.scores[sideOf(mode, s.turn)] += points;
      stat(s, 'points', s.turn, points);
      s.events.push({ kind: 'paseCorrido', seat: s.turn, points });
    }
    return s;
  }

  const { tile, side } = move as Extract<Move, { type: 'play' }>;
  const before = ends(s);
  const willEmpty = s.hands[seat].length === 1;
  const capicua =
    willEmpty && before !== null && before[0] !== before[1] &&
    ((tile[0] === before[0] && tile[1] === before[1]) || (tile[0] === before[1] && tile[1] === before[0]));

  if (move.callPass) {
    // A targeted rival may make their own call. Settle the earlier one before
    // replacing the single pending call for the following seat.
    resolveCall(s, seat, false);
    const target = nextSeat(s, seat);
    s.arcade!.charges[seat]--;
    s.arcade!.callUsed ??= new Array(playerCount(mode)).fill(false);
    s.arcade!.callUsed[seat] = true;
    s.arcade!.call = { caller: seat, target };
    s.events.push({ kind: 'callPass', seat, target });
  }

  lay(s, seat, tile, side);

  if (s.hands[seat].length === 0) return finishHand(s, 'domino', seat, capicua);
  // Arcade hands only block after four passes in a row: a power may still open the game up.
  if (!s.arcade && isBlocked(s)) return finishTranque(s);
  endTurn(s, seat);
  return s;
}

function finishTranque(s: GameState): GameState {
  const mode = s.rules.mode;
  const counts = s.hands.map(handCount);
  const min = Math.min(...counts);
  // Tied seats, in turn order starting from la mano.
  const n = playerCount(mode);
  const order = Array.from({ length: n }, (_, i) => ((s.mano + i) % n) as Seat);
  const tied = order.filter((p) => counts[p] === min);
  let winnerSeat = tied[0];
  let tieToMano = false;
  if (new Set(tied.map((p) => sideOf(mode, p))).size > 1) {
    tieToMano = true;
    winnerSeat = tied.find((p) => sideOf(mode, p) === sideOf(mode, s.mano)) ?? tied[0];
  }
  return finishHand(s, 'tranque', winnerSeat, false, tieToMano);
}

function finishHand(s: GameState, kind: 'domino' | 'tranque', winnerSeat: Seat, capicua: boolean, tieToMano = false): GameState {
  // A final-tile play by the targeted rival settles the wager before scoring.
  if (s.arcade?.call) resolveCall(s, s.arcade.call.target, false);
  const counts = s.hands.map(handCount);
  const arcade = isArcade(s.rules);
  // Arcade: every hand is worth one star, capicúa included (it only gets a celebration).
  const points = arcade ? 1 : counts.reduce((a, b) => a + b, 0);
  const bonus = !arcade && capicua ? s.rules.capicuaBonus : 0;
  const side = sideOf(s.rules.mode, winnerSeat);
  s.scores[side] += points + bonus;
  s.tally.hands[side]++;
  if (capicua) s.tally.capicuas[side]++;
  if (kind === 'tranque') s.tally.tranques[side]++;
  stat(s, 'points', winnerSeat, points + bonus);
  if (kind === 'domino') stat(s, 'dominoes', winnerSeat);
  if (capicua) stat(s, 'capicuas', winnerSeat);
  s.handResult = {
    kind, winnerSeat, side, points, capicua, bonus, total: points + bonus,
    counts, hands: s.hands.map((h) => h.map((t) => [...t] as Tile)), tieToMano,
  };
  if (s.arcade) {
    s.arcade.call = null;
    s.arcade.lock = null;
    s.arcade.powerUsed = false;
  }
  const top = Math.max(...s.scores);
  if (top >= s.rules.target) {
    const leaders = s.scores.flatMap((v, i) => (v === top ? [i] : []));
    s.winner = leaders.includes(side) ? side : leaders[0];
  }
  // Arcade comeback: everyone on the team that lost the hand earns a power for the next one.
  if (s.arcade && s.winner === null) {
    for (const p of seatsOf(s.rules.mode)) if (sideOf(s.rules.mode, p) !== side) earn(s, p, 'comeback');
  }
  return s;
}

/** Pollona: the game was won while nobody else scored a single point. */
export const isPollona = (s: Pick<GameState, 'winner' | 'scores'>) =>
  s.winner !== null && s.scores.every((v, i) => i === s.winner || v === 0);

/** Sides ordered by final score, best first (for ffa 1st/2nd payouts). */
export const standings = (scores: number[]) => scores.map((v, side) => ({ side, score: v })).sort((a, b) => b.score - a.score);

// ---------- Arcade ----------

export const ARCADE = {
  /** Powers each player starts a match with: none, they're earned. */
  startCharges: 0,
  /** Most powers a player can hold at once. */
  maxCharges: 2,
  /** Hands to win the match. */
  stars: 3,
  /** Consecutive unrestricted passes that block a hand. */
  passesToBlock: 4,
} as const;

/** Arcade rules: 2v2, first team to three hands. No bonus points. */
export const arcadeRules = (): Rules => ({ mode: '2v2', target: ARCADE.stars, capicuaBonus: 0, paseCorridoBonus: 0, paseSalidaBonus: 0, ruleset: 'arcade' });

/** Why a power can't be used right now (null = it can). */
export type PowerBlock =
  | 'not_arcade' | 'not_your_turn' | 'hand_over' | 'opening' | 'no_charges' | 'power_used'
  | 'need3' | 'need2' | 'no_sequence' | 'no_change' | 'no_play';

/** Everything a power needs before its own rules: Arcade, my turn, a board, a charge, first power this turn. */
function powerBase(s: GameState, seat: Seat): PowerBlock | null {
  if (!s.arcade) return 'not_arcade';
  if (s.handResult || s.winner !== null) return 'hand_over';
  if (s.turn !== seat) return 'not_your_turn';
  if (s.line.length === 0) return 'opening';
  if (s.arcade.charges[seat] <= 0) return 'no_charges';
  if (s.arcade.powerUsed) return 'power_used';
  return null;
}

export interface DobleSequence { first: { tile: Tile; side: Side }; second: { tile: Tile; side: Side } }
export interface ComodinOption { tile: Tile; side: Side; half: 0 | 1; becomes: Tile }

/** Every Doble golpe: a legal placement, then another legal one on the board it leaves. */
export function dobleSequences(s: GameState, seat: Seat): DobleSequence[] {
  if (s.hands[seat].length < 3) return [];
  const out: DobleSequence[] = [];
  for (const m1 of legalMoves(s, seat)) {
    if (m1.type !== 'play') continue;
    const t: GameState = { ...s, hands: [...s.hands], ...placeOnLine(s.line, s.origin, seat, m1.tile, m1.side) };
    t.hands[seat] = s.hands[seat].filter((x) => !sameTile(x, m1.tile));
    for (const m2 of legalMoves(t, seat)) {
      if (m2.type === 'play') out.push({ first: { tile: m1.tile, side: m1.side }, second: { tile: m2.tile, side: m2.side } });
    }
  }
  return out;
}

/** Every Comodín: a ficha, an open end, and a half that actually changes to connect. */
export function comodinOptions(s: GameState, seat: Seat): ComodinOption[] {
  const e = ends(s);
  if (!e || s.hands[seat].length < 2) return [];
  const locked = lockedFor(s, seat);
  const out: ComodinOption[] = [];
  for (const tile of s.hands[seat]) {
    for (const side of ['L', 'R'] as Side[]) {
      if (side === locked) continue;
      const need = side === 'L' ? e[0] : e[1];
      for (const half of [0, 1] as const) {
        if (tile[half] === need) continue; // nothing would change
        if (half === 1 && tile[0] === tile[1]) continue; // a double's halves are the same choice
        out.push({ tile, side, half, becomes: [need, tile[1 - half]] });
      }
    }
  }
  return out;
}

/** Can this power be used now, and if not, why. */
export function powerBlock(s: GameState, seat: Seat, power: Power): PowerBlock | null {
  const base = powerBase(s, seat);
  if (base) return base;
  const hand = s.hands[seat];
  switch (power) {
    case 'cambio':
      return null; // there's always an opponent with fichas while a hand is on
    case 'doble':
      if (hand.length < 3) return 'need3';
      return dobleSequences(s, seat).length ? null : 'no_sequence';
    case 'comodin':
      if (hand.length < 2) return 'need2';
      return comodinOptions(s, seat).length ? null : 'no_change';
    case 'candado':
      if (hand.length < 2) return 'need2';
      return legalMoves(s, seat).length ? null : 'no_play';
  }
}

/** No ordinary play, but a power could still open something up: the player decides, nobody auto-passes them. */
export const canRescue = (s: GameState, seat: Seat) =>
  !!s.arcade && legalMoves(s, seat).length === 0 && (powerBlock(s, seat, 'cambio') === null || powerBlock(s, seat, 'comodin') === null);

/** A call is staked on an ordinary placement and judged on the next rival's turn. */
export function callPassBlock(s: GameState, seat: Seat): PowerBlock | 'used_hand' | null {
  const base = powerBase(s, seat);
  if (base) return base;
  if (s.arcade?.callUsed?.[seat]) return 'used_hand';
  if (s.hands[seat].length < 2) return 'need2';
  return legalMoves(s, seat).length ? null : 'no_play';
}

/** A power earned (nothing happens at the limit). */
function earn(s: GameState, seat: Seat, reason: 'block' | 'comeback') {
  if (!s.arcade || s.arcade.charges[seat] >= ARCADE.maxCharges) return;
  s.arcade.charges[seat]++;
  s.events.push({ kind: 'earn', seat, reason });
}

function spend(s: GameState, seat: Seat) {
  s.arcade!.charges[seat]--;
  s.arcade!.powerUsed = true;
}

function applyPower(prev: GameState, seat: Seat, move: Move, rng: Rng): GameState {
  const power: Power = move.type === 'play' ? 'candado' : (move.type as Exclude<Power, 'candado'>);
  const block = powerBlock(prev, seat, power);
  if (block) throw new Error(`Power ${power} not available: ${block}`);
  const s: GameState = structuredClone(prev);
  const has = (t: Tile) => s.hands[seat].some((x) => sameTile(x, t));

  if (move.type === 'cambio') {
    if (!has(move.tile)) throw new Error('Not your tile');
    const target = move.target;
    if (target === seat || sideOf(s.rules.mode, target) === sideOf(s.rules.mode, seat) || !s.hands[target]?.length) {
      throw new Error('Bad target');
    }
    const theirs = s.hands[target];
    const incoming = theirs[Math.floor(rng() * theirs.length)];
    s.hands[target] = [...theirs.filter((t) => !sameTile(t, incoming)), move.tile].sort(byValue);
    s.hands[seat] = [...s.hands[seat].filter((t) => !sameTile(t, move.tile)), incoming].sort(byValue);
    // What passing showed about these two hands no longer holds.
    s.voids[seat] = [];
    s.voids[target] = [];
    s.events.push({ kind: 'power', seat, power: 'cambio', target });
    s.arcade!.passes = 0;
    spend(s, seat);
    return s; // same turn, same clock: now play (or pass)
  }

  if (move.type === 'doble') {
    const ok = dobleSequences(s, seat).some((q) =>
      sameTile(q.first.tile, move.first.tile) && q.first.side === move.first.side
      && sameTile(q.second.tile, move.second.tile) && q.second.side === move.second.side);
    if (!ok) throw new Error('Illegal Doble golpe');
    s.events.push({ kind: 'power', seat, power: 'doble' });
    lay(s, seat, move.first.tile, move.first.side);
    lay(s, seat, move.second.tile, move.second.side);
    spend(s, seat);
    endTurn(s, seat);
    return s;
  }

  if (move.type === 'comodin') {
    const opt = comodinOptions(s, seat).find((o) => sameTile(o.tile, move.tile) && o.side === move.side && o.half === move.half);
    if (!opt) throw new Error('Illegal Comodín');
    const from = move.tile[move.half];
    s.events.push({ kind: 'power', seat, power: 'comodin', tile: normalize(move.tile[0], move.tile[1]), side: move.side, from, to: opt.becomes[0] });
    lay(s, seat, move.tile, move.side, move.half);
    spend(s, seat);
    endTurn(s, seat);
    return s;
  }

  // Candado: an ordinary play, then one end of the new board is closed for the next player.
  const play = move as Extract<Move, { type: 'play' }>;
  if (play.lock !== 'L' && play.lock !== 'R') throw new Error('Bad lock');
  if (!isLegal(s, seat, { type: 'play', tile: play.tile, side: play.side })) throw new Error('Illegal play');
  lay(s, seat, play.tile, play.side);
  spend(s, seat);
  endTurn(s, seat);
  s.arcade!.lock = { side: play.lock!, seat: s.turn };
  s.events.push({ kind: 'power', seat, power: 'candado', side: play.lock!, target: s.turn });
  return s;
}

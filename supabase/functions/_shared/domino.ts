// Dominican-style dominó, double-six set, 7 tiles each.
//   2v2 — partners across the table (seats 0+2 vs 1+3), no boneyard.
//   1v1 — two players; the other 14 tiles are the pile you draw from ("robar").
//   ffa — four players, everyone for themselves, no boneyard.
// Pure functions only — this file must stay free of DOM/React so the server
// runs the exact same rules as the browser.

export type Tile = [number, number]; // normalized: tile[0] <= tile[1]
export type Seat = 0 | 1 | 2 | 3;
export type Side = 'L' | 'R';
export type Mode = '1v1' | '2v2' | 'ffa';

/** A tile on the table, oriented left→right: `a` faces the left end, `b` the right end. */
export interface Placed {
  a: number;
  b: number;
  seat: Seat;
}

export type Move = { type: 'play'; tile: Tile; side: Side } | { type: 'pass' } | { type: 'draw' };

export type GameEvent =
  | { kind: 'play'; seat: Seat; tile: Tile; side: Side }
  | { kind: 'pass'; seat: Seat }
  | { kind: 'draw'; seat: Seat }
  | { kind: 'paseCorrido'; seat: Seat; points: number };

export interface HandResult {
  kind: 'domino' | 'tranque';
  winnerSeat: Seat;
  /** Scoring side (team in 2v2, the player in 1v1/ffa). */
  side: number;
  /** Pips the winners score. */
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
  target: number;
  capicuaBonus: number;
  paseCorridoBonus: number;
}

export const CLASSIC_DR: Rules = { mode: '2v2', target: 200, capicuaBonus: 25, paseCorridoBonus: 25 };

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
}

export interface Tally {
  capicuas: number[];
  tranques: number[];
  hands: number[];
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

function startHand(prev: Pick<GameState, 'rules' | 'scores' | 'handNo' | 'tally'>, rng: Rng, mano: Seat | null): GameState {
  const { hands, boneyard } = deal(prev.rules.mode, rng);
  let mustOpen: Tile | null = null;
  if (mano === null) {
    const opener = firstOpener(hands);
    mano = opener.seat;
    mustOpen = opener.tile;
  }
  return {
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
  };
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
  const moves: Move[] = [];
  for (const tile of hand) {
    const fitsL = fits(tile, l);
    const fitsR = fits(tile, r);
    if (fitsL) moves.push({ type: 'play', tile, side: 'L' });
    // Same number on both ends: either side gives the same table, offer one.
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
  if (move.type !== 'play') return forcedMove(state, seat)?.type === move.type;
  return legalMoves(state, seat).some((m) => m.type === 'play' && m.side === move.side && sameTile(m.tile, move.tile));
}

/** Nobody can ever play again: no tile in any hand or the pile matches either end. */
function isBlocked(s: GameState): boolean {
  const e = ends(s)!;
  const matches = (t: Tile) => fits(t, e[0]) || fits(t, e[1]);
  return !s.hands.some((h) => h.some(matches)) && !s.boneyard.some(matches);
}

export function applyMove(prev: GameState, move: Move): GameState {
  if (prev.handResult) throw new Error('Hand is over');
  const seat = prev.turn;
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
    for (const n of e) if (!s.voids[seat].includes(n)) s.voids[seat].push(n);
    s.passesSinceLastPlay++;
    s.events.push({ kind: 'pass', seat });
    s.turn = nextSeat(s, seat);
    // Everyone else passed and it's back to the player who last played.
    if (s.passesSinceLastPlay === playerCount(mode) - 1 && s.turn === s.lastPlayer) {
      const points = s.rules.paseCorridoBonus;
      s.scores[sideOf(mode, s.turn)] += points;
      s.events.push({ kind: 'paseCorrido', seat: s.turn, points });
    }
    return s;
  }

  const { tile, side } = move;
  const before = ends(s);
  const willEmpty = s.hands[seat].length === 1;
  const capicua =
    willEmpty && before !== null && before[0] !== before[1] &&
    ((tile[0] === before[0] && tile[1] === before[1]) || (tile[0] === before[1] && tile[1] === before[0]));

  if (!before) {
    s.line.push({ a: tile[0], b: tile[1], seat });
    s.origin = 0;
  } else if (side === 'L') {
    const other = tile[0] === before[0] ? tile[1] : tile[0];
    s.line.unshift({ a: other, b: before[0], seat });
    s.origin++;
  } else {
    const other = tile[0] === before[1] ? tile[1] : tile[0];
    s.line.push({ a: before[1], b: other, seat });
  }
  s.hands[seat] = s.hands[seat].filter((t) => !sameTile(t, tile));
  s.mustOpen = null;
  s.lastPlayer = seat;
  s.passesSinceLastPlay = 0;
  s.events.push({ kind: 'play', seat, tile, side });

  if (s.hands[seat].length === 0) return finishHand(s, 'domino', seat, capicua);
  if (isBlocked(s)) return finishTranque(s);
  s.turn = nextSeat(s, seat);
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
  const counts = s.hands.map(handCount);
  const points = counts.reduce((a, b) => a + b, 0);
  const bonus = capicua ? s.rules.capicuaBonus : 0;
  const side = sideOf(s.rules.mode, winnerSeat);
  s.scores[side] += points + bonus;
  s.tally.hands[side]++;
  if (capicua) s.tally.capicuas[side]++;
  if (kind === 'tranque') s.tally.tranques[side]++;
  s.handResult = {
    kind, winnerSeat, side, points, capicua, bonus, total: points + bonus,
    counts, hands: s.hands.map((h) => h.map((t) => [...t] as Tile)), tieToMano,
  };
  const top = Math.max(...s.scores);
  if (top >= s.rules.target) {
    const leaders = s.scores.flatMap((v, i) => (v === top ? [i] : []));
    s.winner = leaders.includes(side) ? side : leaders[0];
  }
  return s;
}

/** Pollona: the game was won while nobody else scored a single point. */
export const isPollona = (s: Pick<GameState, 'winner' | 'scores'>) =>
  s.winner !== null && s.scores.every((v, i) => i === s.winner || v === 0);

/** Sides ordered by final score, best first (for ffa 1st/2nd payouts). */
export const standings = (scores: number[]) => scores.map((v, side) => ({ side, score: v })).sort((a, b) => b.score - a.score);

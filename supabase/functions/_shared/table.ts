// Server-side table rules around the dominó engine: what players may see,
// when the server moves for someone, chip payouts, side bets, levels and
// matchmaking. Pure functions — the edge function does the I/O.

import { chooseMove } from './bot.ts';
import {
  forcedMove, isPollona, legalMoves, playerCount, sideOf, standings,
  type GameState, type Mode, type Move, type Rules, type Seat,
} from './domino.ts';

export interface SeatInfo {
  seat: Seat;
  userId: string | null;
  name: string;
  isBot: boolean;
  /** Human who left (or timed out 3 times); the server plays for them. */
  away: boolean;
}

// ---------- visibility ----------

/** Everything but the hands and the pile, plus how many tiles each holds. */
export type PublicState = Omit<GameState, 'hands' | 'boneyard'> & { handCounts: number[]; boneyardCount: number };

export function publicState(s: GameState): PublicState {
  const { hands, boneyard, ...rest } = s;
  return { ...rest, handCounts: hands.map((h) => h.length), boneyardCount: boneyard.length };
}

// ---------- timing ----------

export const TIMING = {
  botMs: 900,
  drawMs: 550,
  autoPassMs: 1300,
  awayMs: 900,
  /** The hand summary stays up this long before the next hand deals itself. */
  nextHandMs: 12_000,
};

/** A human who hasn't moved after this long gets a move played for them (a "strike"). */
export const TURN_SECONDS = { public: 15, customDefault: 25 };
export const MAX_STRIKES = 3;

/**
 * How long after the last move the server will act on its own, or null if it
 * never will. Published with the game so clients only `tick` when it's due.
 */
export function autoDelay(s: GameState, seats: SeatInfo[], turnMs: number): number | null {
  if (s.winner !== null) return null;
  if (s.handResult) return TIMING.nextHandMs;
  const forced = forcedMove(s, s.turn);
  if (forced) return forced.type === 'draw' ? TIMING.drawMs : TIMING.autoPassMs;
  const seat = seats.find((x) => x.seat === s.turn)!;
  return seat.isBot ? TIMING.botMs : seat.away ? TIMING.awayMs : turnMs;
}

export type AutoAction =
  | { kind: 'move'; move: Move; /** a present human ran out of time */ strike: boolean }
  | { kind: 'nextHand' }
  | null;

/** What the server should do on its own at `now`, or null if nothing is due. */
export function autoAction(s: GameState, seats: SeatInfo[], turnMs: number, lastMoveAt: number, now: number): AutoAction {
  const delay = autoDelay(s, seats, turnMs);
  if (delay === null || now - lastMoveAt < delay) return null;
  if (s.handResult) return { kind: 'nextHand' };
  const forced = forcedMove(s, s.turn);
  if (forced) return { kind: 'move', move: forced, strike: false };
  const seat = seats.find((x) => x.seat === s.turn)!;
  return { kind: 'move', move: chooseMove(s, s.turn), strike: !seat.isBot && !seat.away };
}

// ---------- rooms & rules ----------

/** Public rooms: fixed stake per game, and a balance you must have to sit down. */
export const SALAS = [
  { stake: 500, minBalance: 2_500 },
  { stake: 1_000, minBalance: 7_500 },
  { stake: 1_500, minBalance: 15_000 },
  { stake: 2_000, minBalance: 25_000 },
] as const;
/** Friendly matchmaking: real people, no chips on the line. Open to everyone, guests included. */
export const FRIENDLY = { stake: 0, minBalance: 0 } as const;
export const salaFor = (stake: number) => (stake === 0 ? FRIENDLY : SALAS.find((s) => s.stake === stake) ?? null);

/** Public tables only fill with bots once at least this many people are seated (no solo XP farming vs bots). */
export const MIN_PEOPLE_FOR_BOT_FILL = 2;

export const MODES: Mode[] = ['1v1', '2v2', 'ffa'];
export const TARGETS = [100, 150, 200] as const;

export const publicRules = (mode: Mode): Rules => ({ mode, target: 100, capicuaBonus: 25, paseCorridoBonus: 25 });

/** Custom-room settings a host can pick. Anything else is rejected. */
export interface CustomSettings {
  mode: Mode;
  stake: number;
  target: number;
  capicuaBonus: boolean;
  paseCorridoBonus: boolean;
  turnSeconds: number;
  visibility: 'public' | 'private';
}

export const CUSTOM_LIMITS = { maxStake: 100_000, turnSeconds: [15, 25, 40] };

export function validateCustom(c: Partial<CustomSettings>): CustomSettings | null {
  if (!c.mode || !MODES.includes(c.mode)) return null;
  if (!Number.isInteger(c.stake) || c.stake! < 0 || c.stake! > CUSTOM_LIMITS.maxStake) return null;
  if (!TARGETS.includes(c.target as 100)) return null;
  if (!CUSTOM_LIMITS.turnSeconds.includes(c.turnSeconds!)) return null;
  if (c.visibility !== 'public' && c.visibility !== 'private') return null;
  return {
    mode: c.mode, stake: c.stake!, target: c.target!, turnSeconds: c.turnSeconds!, visibility: c.visibility,
    capicuaBonus: c.capicuaBonus !== false, paseCorridoBonus: c.paseCorridoBonus !== false,
  };
}

export const customRules = (c: CustomSettings): Rules => ({
  mode: c.mode, target: c.target,
  capicuaBonus: c.capicuaBonus ? 25 : 0,
  paseCorridoBonus: c.paseCorridoBonus ? 25 : 0,
});

// ---------- chips ----------

const humanSides = (mode: Mode, seats: SeatInfo[]) =>
  new Set(seats.filter((x) => !x.isBot && x.userId).map((x) => sideOf(mode, x.seat)));

/**
 * Who has to be a real person. With chips on the line, 1v1 and 2v2 are
 * people-only (a bot partner or opponent would decide someone's money), and a
 * free-for-all needs at least two people. Free tables can fill up with bots.
 */
export function minHumans(mode: Mode, stake: number): number {
  if (stake === 0) return 1;
  return mode === 'ffa' ? 2 : playerCount(mode);
}
export const botsAllowed = (mode: Mode, stake: number) => minHumans(mode, stake) < playerCount(mode);

/** Chips only move between humans: no bet unless at least two sides have a person. */
export function effectiveStake(mode: Mode, stake: number, seats: SeatInfo[]): number {
  return humanSides(mode, seats).size >= 2 ? stake : 0;
}

export interface Payout {
  userId: string;
  amount: number;
}

/**
 * 1v1 / 2v2: the winning side's humans split the pot.
 * ffa: best-placed human takes 70%, next 30% (bots don't bet, so they don't place).
 */
export function payouts(mode: Mode, stake: number, seats: SeatInfo[], state: Pick<GameState, 'winner' | 'scores'>): Payout[] {
  const humans = seats.filter((x) => !x.isBot && x.userId);
  const pot = stake * humans.length;
  if (pot === 0 || state.winner === null) return [];

  if (mode !== 'ffa') {
    const winners = humans.filter((x) => sideOf(mode, x.seat) === state.winner);
    if (winners.length === 0) return [];
    const share = Math.floor(pot / winners.length);
    return winners.map((w) => ({ userId: w.userId!, amount: share }));
  }

  const ranked = standings(state.scores).filter((r) => humans.some((h) => h.seat === r.side));
  const byScore = new Map<number, SeatInfo[]>();
  for (const r of ranked) {
    const h = humans.find((x) => x.seat === r.side)!;
    byScore.set(r.score, [...(byScore.get(r.score) ?? []), h]);
  }
  // Walk down the places; tied players split the shares of the places they cover.
  const shares = [0.7, 0.3];
  const out: Payout[] = [];
  let place = 0;
  for (const [, group] of [...byScore.entries()].sort((a, b) => b[0] - a[0])) {
    if (place >= shares.length) break;
    const covered = shares.slice(place, place + group.length).reduce((a, b) => a + b, 0);
    for (const h of group) out.push({ userId: h.userId!, amount: Math.floor((pot * covered) / group.length) });
    place += group.length;
  }
  return out;
}

export const CHIPS = { starting: 5000, daily: 1000, rescueBelow: 500, rescue: 500 };

// ---------- chests ----------

export type ChestKind = 'wood' | 'silver' | 'gold' | 'diamond';
export const CHEST_SLOTS = 4;

/** Win an online game against at least one other person → a chest (if a slot is free). */
export const CHESTS: Record<ChestKind, { chance: number; unlockMin: number; chips: [number, number]; xp: number }> = {
  wood: { chance: 0.6, unlockMin: 30, chips: [100, 200], xp: 10 },
  silver: { chance: 0.28, unlockMin: 180, chips: [250, 450], xp: 25 },
  gold: { chance: 0.1, unlockMin: 480, chips: [600, 1000], xp: 60 },
  diamond: { chance: 0.02, unlockMin: 720, chips: [2000, 3000], xp: 150 },
};
export const CHEST_ORDER: ChestKind[] = ['wood', 'silver', 'gold', 'diamond'];

export function rollChest(rng: () => number = Math.random): ChestKind {
  let r = rng();
  for (const k of CHEST_ORDER) {
    if (r < CHESTS[k].chance) return k;
    r -= CHESTS[k].chance;
  }
  return 'wood';
}

export function chestReward(kind: ChestKind, rng: () => number = Math.random) {
  const [lo, hi] = CHESTS[kind].chips;
  return { chips: Math.round((lo + rng() * (hi - lo)) / 10) * 10, xp: CHESTS[kind].xp };
}

/** Skip the wait: 25 chips per 5 minutes left (a small chip sink). */
export const rushCost = (msLeft: number) => Math.max(25, Math.ceil(msLeft / 300_000) * 25);

// ---------- shop (Stripe) ----------

/** Chips are bought one way only — they never turn back into money. */
export const CHIP_PACKS = [
  { id: 'p5k', chips: 5_000, cents: 199, tag: null },
  { id: 'p15k', chips: 15_000, cents: 499, tag: 'popular' },
  { id: 'p40k', chips: 40_000, cents: 999, tag: null },
  { id: 'p100k', chips: 100_000, cents: 1999, tag: 'best' },
] as const;
export const packFor = (id: string) => CHIP_PACKS.find((p) => p.id === id) ?? null;

// ---------- pre-game side bets ----------

export type SideBetKind = 'cap1' | 'cap2' | 'pollona';
export const SIDE_BET_KINDS: SideBetKind[] = ['cap1', 'cap2', 'pollona'];

/**
 * Chance that YOUR side hits each bet, from 4,000 simulated bot games per
 * mode/target (2026-09-25). Re-tune from real results once people play.
 */
const SIDE_BET_ODDS: Record<string, Record<SideBetKind, number>> = {
  '1v1@100': { cap1: 0.3068, cap2: 0.0367, pollona: 0.0757 },
  '1v1@150': { cap1: 0.4125, cap2: 0.086, pollona: 0.0267 },
  '1v1@200': { cap1: 0.489, cap2: 0.1323, pollona: 0.014 },
  '2v2@100': { cap1: 0.2395, cap2: 0.0225, pollona: 0.137 },
  '2v2@150': { cap1: 0.3435, cap2: 0.0587, pollona: 0.068 },
  '2v2@200': { cap1: 0.4377, cap2: 0.1017, pollona: 0.0293 },
  'ffa@100': { cap1: 0.142, cap2: 0.0107, pollona: 0.0305 },
  'ffa@150': { cap1: 0.2185, cap2: 0.0285, pollona: 0.008 },
  'ffa@200': { cap1: 0.3085, cap2: 0.0597, pollona: 0.0047 },
};

/** The house keeps ~15% so side bets drain a little of the chips the daily bonus adds. */
const HOUSE_EDGE = 0.15;
const MAX_MULTIPLIER = 50;

/** Total returned per chip bet (includes the chip itself), e.g. 3.5 → bet 100, get 350. */
export function sideBetMultiplier(rules: Pick<Rules, 'mode' | 'target'>, kind: SideBetKind): number | null {
  const p = SIDE_BET_ODDS[`${rules.mode}@${rules.target}`]?.[kind];
  if (!p) return null;
  return Math.min(MAX_MULTIPLIER, Math.floor(((1 - HOUSE_EDGE) / p) * 10) / 10);
}

/** Did a finished game pay out this bet for `side`? */
export function sideBetWon(kind: SideBetKind, state: Pick<GameState, 'winner' | 'scores' | 'tally'>, side: number): boolean {
  if (kind === 'cap1') return state.tally.capicuas[side] >= 1;
  if (kind === 'cap2') return state.tally.capicuas[side] >= 2;
  return state.winner === side && isPollona(state);
}

/** Side bets together can't exceed the table stake (keeps throwing a game for a bet pointless). */
export const sideBetLimit = (stake: number) => stake;

// ---------- levels ----------

/** XP needed to reach `level` (level 1 = 0 XP, 2 = 100, 3 = 300, 5 = 1,000, 10 = 4,500). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelTitle(level: number): { es: string; en: string } {
  if (level >= 35) return { es: 'Leyenda', en: 'Legend' };
  if (level >= 20) return { es: 'Capo', en: 'Boss' };
  if (level >= 10) return { es: 'Jefe', en: 'Chief' };
  if (level >= 5) return { es: 'Tíguere', en: 'Hustler' };
  return { es: 'Novato', en: 'Rookie' };
}

export function gameXp(o: { won: boolean; capicuas: number; pollona: boolean; placedSecond?: boolean }): number {
  return 20 + (o.won ? 30 : o.placedSecond ? 12 : 0) + 5 * o.capicuas + (o.pollona ? 20 : 0);
}
export const LEAVER_XP = -30;

// ---------- matchmaking ----------

/** Levels within this many of each other skip the ready check and just count down. */
export const LEVEL_GAP_FOR_READY = 5;
export const LOBBY = { countdownMs: 10_000, readyMs: 20_000, allReadyMs: 3_000, declineLimit: 3, declineWindowMin: 10, declineCooldownMin: 5 };

export const seatsNeeded = (mode: Mode) => playerCount(mode);

export function needsReadyCheck(levels: number[]): boolean {
  return Math.max(...levels) - Math.min(...levels) > LEVEL_GAP_FOR_READY;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — easy to read out loud

/** Table codes are 4 letters, tournament codes 5 — so one "enter a code" box can tell them apart. */
export function roomCode(rng: () => number = Math.random, length = 4): string {
  return Array.from({ length }, () => CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)]).join('');
}

/** Voice policy: full table in custom and tournament rooms, teammates only in public 2v2, none in public 1v1/ffa. */
export function voiceRoomFor(kind: 'public' | 'custom' | 'tournament', mode: Mode, code: string, seat: Seat): string | null {
  if (kind !== 'public') return `capicua-${code}`;
  if (mode === '2v2') return `capicua-${code}-team${seat % 2}`;
  return null;
}

/** Only one-legal-move turns are autoplayed client-side; kept here so both sides agree. */
export const onlyMove = (s: GameState, seat: Seat) => {
  const m = legalMoves(s, seat);
  return m.length === 1 ? m[0] : null;
};

// Private knockout tournaments: bracket shape, byes, who goes where, final
// placings and prize money. Pure functions — the game function does the I/O
// and the browser draws the bracket from the same numbers.

import type { Mode, Rules } from './domino.ts';
import { paseSalidaFor, TARGETS } from './table.ts';

export type TournamentMode = Extract<Mode, '1v1' | '2v2'>;
/**
 * How the first round is matched: a draw ('random'), by experience — the most XP plays the
 * least ('xp') — or the players pick their opponents before the start ('pick'). Whatever
 * the mode, an admin can fix any match by hand.
 */
export type Seeding = 'random' | 'xp' | 'pick';
export const SEEDINGS: Seeding[] = ['random', 'xp', 'pick'];
/**
 * Who can find it: 'private' — only with the code or an invite; 'public' — listed in Mesas →
 * Torneos abiertos for anyone to join. Official tournaments (made by an admin) are always public.
 */
export type Visibility = 'private' | 'public';
export const VISIBILITIES: Visibility[] = ['private', 'public'];
export const TOURNAMENT_MODES: TournamentMode[] = ['1v1', '2v2'];
/** Bracket slots a host can open: players in 1v1, pairs in 2v2. */
export const TOURNAMENT_SIZES = [4, 8, 16] as const;

export const TOURNAMENT = {
  /** People needed to start, whatever the mode. */
  minPlayers: 4,
  maxBuyIn: 100_000,
  /** Once a match is set, both sides get this long to press Ready. */
  noShowMs: 180_000,
  /** A reminder buzzes whoever hasn't pressed Ready when this much is left. */
  readyReminderMs: 60_000,
  /** Check-in opens this long before the start time. */
  checkInMs: 15 * 60_000,
  /** Last-call reminder to whoever hasn't checked in yet. */
  lastCallMs: 3 * 60_000,
  /** The start time the host picks: at least this far ahead… */
  minLeadMs: 5 * 60_000,
  /** …and at most this far. */
  maxLeadMs: 7 * 24 * 60 * 60_000,
  /** A game nobody has touched for this long past its turn timer is played out by the server. */
  abandonedMs: 60_000,
  /** 1st and 2nd share of the pot. */
  prizeShares: [0.7, 0.3] as const,
  championXp: 100,
  runnerUpXp: 40,
  codeLength: 5,
  /** Public tournaments one player may have open (not started) at a time. */
  maxOpenPublic: 2,
  /** The house prize an admin may add to an official tournament. */
  maxPrize: 1_000_000,
  descriptionMax: 200,
};

export const playersPerEntry = (mode: TournamentMode) => (mode === '2v2' ? 2 : 1);
/** Entries (players or pairs) needed to start: always at least 4 people. */
export const minEntries = (mode: TournamentMode) => TOURNAMENT.minPlayers / playersPerEntry(mode);

export interface TournamentSettings {
  name: string;
  mode: TournamentMode;
  size: (typeof TOURNAMENT_SIZES)[number];
  buyIn: number;
  target: number;
  turnSeconds: number;
  /**
   * When it starts (epoch ms). Players check in during the 15 minutes before;
   * whoever hasn't by then is taken off the list before the draw. Missing only
   * on tournaments made by an older app: the host starts those by hand.
   */
  startsAt?: number;
  /** How the first round is matched (older tournaments: a draw). */
  seeding?: Seeding;
  /** Private (code or invite) unless the host makes it public. */
  visibility?: Visibility;
  /**
   * Made by an admin for everyone ("Capicúa" organizes it): always public, the admin doesn't
   * play in it, and it may carry a house prize and a description. The server checks the admin.
   */
  official?: boolean;
  /** Official only: chips the house adds to the pot (split 70/30 like the rest). */
  prize?: number;
  /** Official only: a few words for the details players see before joining. */
  description?: string;
  /** Official only: show it on the home screen from the start. */
  featured?: boolean;
}

/** Tidy a description: trimmed, single spaces, no control characters; '' when empty. Null when too long. */
export function cleanDescription(d: unknown): string | null {
  const s = String(d ?? '').replace(/[\p{Cc}\u200b-\u200d\ufeff]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s.length > TOURNAMENT.descriptionMax ? null : s;
}

const validPrize = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 0 && (p as number) <= TOURNAMENT.maxPrize;

export function validateTournament(s: Partial<TournamentSettings>, now = Date.now()): TournamentSettings | null {
  const name = String(s.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 30) return null;
  if (!s.mode || !TOURNAMENT_MODES.includes(s.mode)) return null;
  if (!TOURNAMENT_SIZES.includes(s.size as 4)) return null;
  if (!Number.isInteger(s.buyIn) || s.buyIn! < 0 || s.buyIn! > TOURNAMENT.maxBuyIn) return null;
  if (!TARGETS.includes(s.target as 100)) return null;
  if (![15, 25, 40].includes(s.turnSeconds!)) return null;
  const out: TournamentSettings = { name, mode: s.mode, size: s.size!, buyIn: s.buyIn!, target: s.target!, turnSeconds: s.turnSeconds! };
  if (s.seeding !== undefined) {
    if (!SEEDINGS.includes(s.seeding)) return null;
    out.seeding = s.seeding;
  }
  if (s.startsAt !== undefined && s.startsAt !== null) {
    // A minute of slack for the time it takes to press Create.
    if (!Number.isFinite(s.startsAt) || s.startsAt < now + TOURNAMENT.minLeadMs - 60_000 || s.startsAt > now + TOURNAMENT.maxLeadMs) return null;
    out.startsAt = Math.round(s.startsAt);
  }
  if (s.visibility !== undefined) {
    if (!VISIBILITIES.includes(s.visibility)) return null;
    out.visibility = s.visibility;
  }
  if (s.official) {
    out.official = true;
    out.visibility = 'public';
    if (s.prize !== undefined) {
      if (!validPrize(s.prize)) return null;
      out.prize = s.prize;
    }
    if (s.description !== undefined) {
      const d = cleanDescription(s.description);
      if (d === null) return null;
      if (d) out.description = d;
    }
    if (s.featured) out.featured = true;
  } else if (s.prize || s.description || s.featured) {
    // Only the house adds prizes, descriptions and home-screen spots.
    return null;
  }
  return out;
}

/**
 * Changes before the start. The host may change the name, the start time (or clear it: then
 * they start it by hand), the target, the turn timer, how the first round is matched and whether
 * it's public; an admin may also change the size, and (official tournaments) the house prize and
 * the description. Buy-in and mode never change once people have joined.
 */
export interface TournamentEdit {
  name?: string;
  startsAt?: number | null;
  target?: number;
  turnSeconds?: number;
  seeding?: Seeding;
  size?: (typeof TOURNAMENT_SIZES)[number];
  visibility?: Visibility;
  prize?: number;
  description?: string;
}

export function validateTournamentEdit(c: TournamentEdit, admin: boolean, now = Date.now()): TournamentEdit | null {
  const out: TournamentEdit = {};
  if (c.name !== undefined) {
    const name = String(c.name).trim().replace(/\s+/g, ' ');
    if (name.length < 3 || name.length > 30) return null;
    out.name = name;
  }
  if (c.startsAt !== undefined) {
    if (c.startsAt === null) out.startsAt = null;
    else if (!Number.isFinite(c.startsAt) || c.startsAt < now + TOURNAMENT.minLeadMs - 60_000 || c.startsAt > now + TOURNAMENT.maxLeadMs) return null;
    else out.startsAt = Math.round(c.startsAt);
  }
  if (c.target !== undefined) {
    if (!TARGETS.includes(c.target as 100)) return null;
    out.target = c.target;
  }
  if (c.turnSeconds !== undefined) {
    if (![15, 25, 40].includes(c.turnSeconds)) return null;
    out.turnSeconds = c.turnSeconds;
  }
  if (c.seeding !== undefined) {
    if (!SEEDINGS.includes(c.seeding)) return null;
    out.seeding = c.seeding;
  }
  if (c.size !== undefined) {
    if (!admin || !TOURNAMENT_SIZES.includes(c.size)) return null;
    out.size = c.size;
  }
  if (c.visibility !== undefined) {
    if (!VISIBILITIES.includes(c.visibility)) return null;
    out.visibility = c.visibility;
  }
  if (c.prize !== undefined) {
    if (!admin || !validPrize(c.prize)) return null;
    out.prize = c.prize;
  }
  if (c.description !== undefined) {
    const d = cleanDescription(c.description);
    if (!admin || d === null) return null;
    out.description = d;
  }
  return Object.keys(out).length ? out : null;
}

/** Check-in is open from 15 minutes before the start. */
export const checkInOpen = (startsAt: number, now: number) => now >= startsAt - TOURNAMENT.checkInMs;

export const tournamentRules = (s: Pick<TournamentSettings, 'mode' | 'target'>): Rules =>
  ({ mode: s.mode, target: s.target, capicuaBonus: 25, paseCorridoBonus: 25, paseSalidaBonus: paseSalidaFor(s.mode), tranque: 'patio' });

/** Smallest power of two that fits every entry: the first round's slot count. */
export function bracketSize(entries: number): number {
  let n = 2;
  while (n < entries) n *= 2;
  return n;
}

export const roundCount = (entries: number) => Math.log2(bracketSize(entries));

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * First-round pairings, in bracket order. Entries are drawn at random; empty
 * slots become byes, never two in one match (a bye always meets a real entry,
 * which goes straight through).
 */
export function firstRound<T>(entries: T[], rng: () => number = Math.random): [T, T | null][] {
  const drawn = shuffle(entries, rng);
  const size = bracketSize(drawn.length);
  const byes = size - drawn.length;
  const matches: [T, T | null][] = [];
  let i = 0;
  for (let m = 0; m < size / 2; m++) {
    matches.push(m < byes ? [drawn[i++], null] : [drawn[i++], drawn[i++]]);
  }
  return shuffle(matches, rng);
}

/** Bracket order of seeds 1…n (n a power of two): seeds 1 and 2 can only meet in the final. */
export function seedOrder(n: number): number[] {
  let order = [1];
  while (order.length < n) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m + 1 - s]);
  }
  return order;
}

/**
 * Matches fixed before the draw (an admin's, or players' picks) that can still be kept, in the
 * order given: both entries still in, nobody twice, and no more than leave everyone else a
 * real opponent or a bye (n − size/2 pairs at most).
 */
export function keptPairs(ids: string[], pairs: [string, string][]): [string, string][] {
  const limit = ids.length - bracketSize(ids.length) / 2;
  const present = new Set(ids);
  const used = new Set<string>();
  const out: [string, string][] = [];
  for (const [a, b] of pairs) {
    if (out.length >= limit) break;
    if (a === b || !present.has(a) || !present.has(b) || used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    out.push([a, b]);
  }
  return out;
}

export interface Seedable { id: string; xp: number }

/**
 * The first round, in bracket order. Fixed matches go in as they are; everyone else is drawn
 * ('random', 'pick') or seeded by experience ('xp'): the byes go to the most XP, the best left
 * plays the least XP left, and the strongest matches are spread so the top two can only meet
 * in the final. Never two byes in one match.
 */
export function drawFirstRound<T extends Seedable>(entries: T[], seeding: Seeding, fixed: [string, string][] = [], rng: () => number = Math.random): [T, T | null][] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const size = bracketSize(entries.length);
  const matches: [T, T | null][] = keptPairs(entries.map((e) => e.id), fixed).map(([a, b]) => [byId.get(a)!, byId.get(b)!]);
  const taken = new Set(matches.flatMap(([a, b]) => [a.id, b!.id]));
  const byes = size - entries.length;
  let rest = entries.filter((e) => !taken.has(e.id));
  if (seeding === 'xp') {
    rest = [...rest].sort((x, y) => y.xp - x.xp || (x.id < y.id ? -1 : 1));
    for (const e of rest.splice(0, byes)) matches.push([e, null]);
    while (rest.length >= 2) matches.push([rest.shift()!, rest.pop()!]);
    const top = (m: [T, T | null]) => Math.max(m[0].xp, m[1]?.xp ?? -Infinity);
    const ranked = [...matches].sort((a, b) => top(b) - top(a));
    return seedOrder(size / 2).map((rank) => ranked[rank - 1]);
  }
  rest = shuffle(rest, rng);
  for (const e of rest.splice(0, byes)) matches.push([e, null]);
  while (rest.length >= 2) matches.push([rest.shift()!, rest.shift()!]);
  return shuffle(matches, rng);
}

/** Where a match's winner plays next: slot in the next round and which side of it. */
export const nextMatch = (round: number, slot: number) => ({ round: round + 1, slot: slot >> 1, side: slot % 2 === 0 ? 'a' : 'b' } as const);

/** Final placing for an entry knocked out in `round` (2 = runner-up, 3 = semifinalists, 5 = quarterfinalists…). */
export const placementFor = (round: number, rounds: number) => 2 ** (rounds - round) + 1;

/** Which stage a round is, counting back from the final (for labels). */
export function stage(round: number, rounds: number): 'final' | 'semi' | 'quarter' | 'r16' {
  const left = rounds - round;
  return left === 0 ? 'final' : left === 1 ? 'semi' : left === 2 ? 'quarter' : 'r16';
}

/**
 * The Ready clock ran out and not everyone pressed it. A side is out only if
 * nobody from it showed up: with someone on each side the game is played (a
 * missing partner's chair is played by the server until they arrive). Nobody
 * at all: both are out.
 */
export function noShowOutcome(readyA: number, readyB: number): 'play' | 'a' | 'b' | 'none' {
  if (readyA > 0 && readyB > 0) return 'play';
  if (readyA > 0) return 'a';
  if (readyB > 0) return 'b';
  return 'none';
}

/**
 * What the next match does once both matches feeding it are over, from their
 * winners (null = nobody went through, both no-shows): open the table, send
 * the one entry straight on, or pass the empty slot along.
 */
export function afterFeeders(a: string | null, b: string | null): { play: [string, string] } | { bye: string } | 'empty' {
  if (a && b) return { play: [a, b] };
  if (a || b) return { bye: (a ?? b)! };
  return 'empty';
}

/**
 * Prize money: 70% of the pot to the champion's players, 30% to the
 * runner-up's, split evenly inside a pair. Rounding leftovers go to each
 * entry's first player so the pot is paid out to the last chip. No champion
 * (neither finalist showed up for the final): the two finalists share it all.
 */
export function prizes(pot: number, champion: string[], runnerUp: string[]): { userId: string; amount: number }[] {
  if (pot <= 0) return [];
  if (champion.length === 0) {
    if (runnerUp.length === 0) return [];
    const each = Math.floor(pot / runnerUp.length);
    return runnerUp.map((userId, i) => ({ userId, amount: each + (i === 0 ? pot - each * runnerUp.length : 0) }));
  }
  const first = runnerUp.length ? Math.floor(pot * TOURNAMENT.prizeShares[0]) : pot;
  const shares: [string[], number][] = [[champion, first], [runnerUp, pot - first]];
  const out: { userId: string; amount: number }[] = [];
  for (const [players, total] of shares) {
    if (players.length === 0 || total <= 0) continue;
    const each = Math.floor(total / players.length);
    players.forEach((userId, i) => out.push({ userId, amount: each + (i === 0 ? total - each * players.length : 0) }));
  }
  return out;
}

// What a new table state should sound like and whether it earns a bonus pop-up.
// Pure: compares the last state the screen showed with the new one, so a
// reload or re-render of the same state never replays anything.

import { sideOf, standings, type GameEvent, type Seat } from '../../supabase/functions/_shared/domino.ts';
import type { PublicState } from '../../supabase/functions/_shared/table.ts';

export type Sfx = 'tile' | 'knock' | 'draw' | 'capicua' | 'paseCorrido' | 'win' | 'second' | 'lose';

/** Extra points worth celebrating on screen. */
export interface Bonus {
  kind: 'capicua' | 'paseCorrido' | 'paseSalida';
  seat: Seat;
  points: number;
  /** Unique per occurrence, so the same pop-up never shows twice. */
  key: string;
}

/** The little the next comparison needs to remember about a state. */
export interface FxSnapshot {
  handNo: number;
  events: number;
  handOver: boolean;
  winner: number | null;
}

export const snapshotOf = (v: PublicState): FxSnapshot => ({
  handNo: v.handNo, events: v.events.length, handOver: v.handResult !== null, winner: v.winner,
});

/** At most this many move sounds per update (a burst after a slow connection shouldn't rattle on). */
const MAX_MOVE_SOUNDS = 3;

type MoveEvent = Extract<GameEvent, { kind: 'play' | 'pass' | 'draw' }>;
const isMove = (e: GameEvent): e is MoveEvent => e.kind === 'play' || e.kind === 'pass' || e.kind === 'draw';
const soundOf = (e: MoveEvent): Sfx => (e.kind === 'play' ? 'tile' : e.kind === 'pass' ? 'knock' : 'draw');

export interface TableFx {
  /** New moves, oldest first, with who made them. */
  moves: { sound: Sfx; seat: Seat }[];
  /** Capicúa / pase corrido / pase de salida fanfare to play after the moves. */
  fanfare: Sfx | null;
  bonus: Bonus | null;
  /** Arcade: the newest power used (it has its own sound, and some are announced). */
  powerEvent: Extract<GameEvent, { kind: 'power' }> | null;
  /** Arcade: powers just earned. */
  earned: Extract<GameEvent, { kind: 'earn' }>[];
  /** The game just ended: how it sounds for the player at the bottom seat. */
  ending: 'win' | 'second' | 'lose' | null;
}

export function tableFx(prev: FxSnapshot | null, view: PublicState, mySeat: Seat): TableFx {
  const none: TableFx = { moves: [], fanfare: null, bonus: null, ending: null, powerEvent: null, earned: [] };
  if (!prev) return none; // first look at this table: nothing "just happened"
  const sameHand = prev.handNo === view.handNo;
  if (sameHand && view.events.length < prev.events) return none; // an older state arrived late
  const fresh = view.events.slice(sameHand ? prev.events : 0);

  const moves = fresh.filter(isMove).slice(-MAX_MOVE_SOUNDS).map((e) => ({ sound: soundOf(e), seat: e.seat }));
  const lastPower = [...fresh].reverse().find((e) => e.kind === 'power');
  const powerEvent = lastPower?.kind === 'power' ? lastPower : null;
  const earned = fresh.filter((e): e is Extract<GameEvent, { kind: 'earn' }> => e.kind === 'earn');
  let fanfare: Sfx | null = null;
  let bonus: Bonus | null = null;

  // Both passes share the pase corrido "ta-da"; the newest one gets the pop-up.
  const pase = [...fresh].reverse().find((e) => e.kind === 'paseCorrido' || e.kind === 'paseSalida');
  if (pase?.kind === 'paseCorrido' || pase?.kind === 'paseSalida') {
    fanfare = 'paseCorrido';
    const tag = pase.kind === 'paseCorrido' ? 'pc' : 'ps';
    bonus = { kind: pase.kind, seat: pase.seat, points: pase.points, key: `${tag}:${view.handNo}:${view.events.lastIndexOf(pase)}` };
  }
  const r = view.handResult;
  const handJustEnded = r !== null && (!sameHand || !prev.handOver);
  if (handJustEnded && r.capicua) {
    fanfare = 'capicua';
    bonus = { kind: 'capicua', seat: r.winnerSeat, points: r.bonus, key: `cap:${view.handNo}` };
  }

  let ending: TableFx['ending'] = null;
  if (view.winner !== null && prev.winner === null) {
    const mode = view.rules.mode;
    const mySide = sideOf(mode, mySeat);
    if (view.winner === mySide) ending = 'win';
    else if (mode === 'ffa' && standings(view.scores)[1]?.side === mySide) ending = 'second';
    else ending = 'lose';
  }
  return { moves, fanfare, bonus, ending, powerEvent, earned };
}

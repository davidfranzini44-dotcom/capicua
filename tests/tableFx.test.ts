import { describe, expect, it } from 'vitest';
import type { GameEvent, HandResult, Seat } from '../supabase/functions/_shared/domino.ts';
import { publicRules, type PublicState } from '../supabase/functions/_shared/table.ts';
import { snapshotOf, tableFx } from '../src/lib/tableFx.ts';

/** Just the parts of a table state the effects look at. */
function view(over: Partial<PublicState> & { mode?: '1v1' | '2v2' | 'ffa' } = {}): PublicState {
  const { mode = '2v2', ...rest } = over;
  return {
    rules: publicRules(mode), scores: mode === '2v2' ? [0, 0] : mode === '1v1' ? [0, 0] : [0, 0, 0, 0], handNo: 1,
    line: [], origin: 0, mano: 0, turn: 0, lastPlayer: null, passesSinceLastPlay: 0, mustOpen: null, voids: [[], [], [], []],
    events: [], handResult: null, winner: null, tally: { capicuas: [0, 0], tranques: [0, 0], hands: [0, 0] },
    handCounts: [7, 7, 7, 7], boneyardCount: 0,
    ...rest,
  } as PublicState;
}
const play = (seat: Seat): GameEvent => ({ kind: 'play', seat, tile: [1, 2], side: 'R' });
const pass = (seat: Seat): GameEvent => ({ kind: 'pass', seat });
const result = (over: Partial<HandResult> = {}): HandResult => ({
  kind: 'domino', winnerSeat: 0, side: 0, points: 30, capicua: false, bonus: 0, total: 30,
  counts: [0, 10, 10, 10], hands: [[], [], [], []], tieToMano: false, ...over,
});

describe('table sounds and bonus pop-ups', () => {
  it('stays quiet the first time a table is shown (a reload replays nothing)', () => {
    const v = view({ events: [play(0), play(1)], handResult: result({ capicua: true, bonus: 25 }) });
    expect(tableFx(null, v, 0)).toEqual({ moves: [], fanfare: null, bonus: null, ending: null, powerEvent: null, earned: [], callResults: [] });
  });

  it('clacks for a tile, knocks for a pass, slides for a draw', () => {
    const before = view({ events: [play(0)] });
    const after = view({ events: [play(0), play(1), pass(2), { kind: 'draw', seat: 3 }] });
    expect(tableFx(snapshotOf(before), after, 0).moves).toEqual([
      { sound: 'tile', seat: 1 }, { sound: 'knock', seat: 2 }, { sound: 'draw', seat: 3 },
    ]);
  });

  it('plays only the last few moves after a burst', () => {
    const after = view({ events: [play(0), play(1), play(2), play(3), play(0)] });
    expect(tableFx(snapshotOf(view()), after, 0).moves).toHaveLength(3);
  });

  it('says nothing for the same state twice, or an older one arriving late', () => {
    const v = view({ events: [play(0), play(1)] });
    expect(tableFx(snapshotOf(v), v, 0).moves).toEqual([]);
    expect(tableFx(snapshotOf(v), view({ events: [play(0)] }), 0).moves).toEqual([]);
  });

  it('pops up a pase corrido with its points and who got it', () => {
    const before = view({ events: [play(1), pass(2), pass(3)] });
    const after = view({ events: [play(1), pass(2), pass(3), pass(0), { kind: 'paseCorrido', seat: 1, points: 25 }] });
    const fx = tableFx(snapshotOf(before), after, 0);
    expect(fx.fanfare).toBe('paseCorrido');
    expect(fx.bonus).toMatchObject({ kind: 'paseCorrido', seat: 1, points: 25 });
    expect(fx.moves).toEqual([{ sound: 'knock', seat: 0 }]);
  });

  it('pops up a pase de salida for the team that opened, with the pase "ta-da"', () => {
    const before = view({ events: [play(0)] });
    const after = view({ events: [play(0), pass(1), { kind: 'paseSalida', seat: 0, points: 30 }] });
    const fx = tableFx(snapshotOf(before), after, 1);
    expect(fx.fanfare).toBe('paseCorrido');
    expect(fx.bonus).toMatchObject({ kind: 'paseSalida', seat: 0, points: 30, key: 'ps:1:2' });
    expect(fx.moves).toEqual([{ sound: 'knock', seat: 1 }]);
  });

  it('pops up a capicúa when the hand ends on one, once', () => {
    const before = view({ events: [play(0)] });
    const after = view({ events: [play(0), play(1)], handResult: result({ winnerSeat: 1, side: 1, capicua: true, bonus: 25 }) });
    const fx = tableFx(snapshotOf(before), after, 0);
    expect(fx.fanfare).toBe('capicua');
    expect(fx.bonus).toMatchObject({ kind: 'capicua', seat: 1, points: 25, key: 'cap:1' });
    expect(tableFx(snapshotOf(after), after, 0).bonus).toBeNull();
  });

  it('a plain domino or tranque gets no pop-up', () => {
    const after = view({ events: [play(0)], handResult: result({ kind: 'tranque' }) });
    expect(tableFx(snapshotOf(view()), after, 0).bonus).toBeNull();
  });

  it('plays the winning sound for the winners and the losing one for the rest', () => {
    const before = view({ events: [play(0)] });
    const over = view({ events: [play(0), play(1)], handResult: result({ winnerSeat: 1, side: 1 }), winner: 1, scores: [40, 105] });
    expect(tableFx(snapshotOf(before), over, 1).ending).toBe('win');
    expect(tableFx(snapshotOf(before), over, 3).ending).toBe('win'); // partner
    expect(tableFx(snapshotOf(before), over, 0).ending).toBe('lose');
  });

  it('second place in free-for-all gets its own little chime', () => {
    const before = view({ mode: 'ffa' });
    const over = view({ mode: 'ffa', winner: 2, scores: [60, 20, 101, 10], handResult: result({ winnerSeat: 2, side: 2 }) });
    expect(tableFx(snapshotOf(before), over, 0).ending).toBe('second');
    expect(tableFx(snapshotOf(before), over, 1).ending).toBe('lose');
  });

  it('a new hand starts counting its moves from scratch', () => {
    const lastHand = view({ handNo: 1, events: [play(0), play(1), play(2)], handResult: result() });
    const next = view({ handNo: 2, events: [play(1)] });
    expect(tableFx(snapshotOf(lastHand), next, 0).moves).toEqual([{ sound: 'tile', seat: 1 }]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyMove, CLASSIC_DR, forcedMove, handCount, legalMoves, newGame, nextHand, playerCount,
  type GameState, type Mode, type Rules, type Seat, type Tile,
} from '../supabase/functions/_shared/domino.ts';
import { chooseMove } from '../supabase/functions/_shared/bot.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const rulesOf = (mode: Mode, target = 200): Rules => ({ ...CLASSIC_DR, mode, target });

/** Build a mid-hand state directly, for rule-specific tests. */
function stateWith(hands: Tile[][], line: [number, number][], turn: Seat, extra: Partial<GameState> = {}): GameState {
  const rules = extra.rules ?? CLASSIC_DR;
  const sides = rules.mode === '2v2' ? 2 : hands.length;
  return {
    rules, scores: new Array(sides).fill(0), handNo: 2, hands, boneyard: [],
    line: line.map(([a, b]) => ({ a, b, seat: 0 as Seat })), origin: 0,
    mano: 0, turn, lastPlayer: null, passesSinceLastPlay: 0, mustOpen: null,
    voids: hands.map(() => []), events: [], handResult: null, winner: null,
    tally: { capicuas: new Array(sides).fill(0), tranques: new Array(sides).fill(0), hands: new Array(sides).fill(0) },
    ...extra,
  };
}

describe('2v2 (classic)', () => {
  it('first hand must open with the doble seis', () => {
    const g = newGame(seeded(1));
    const moves = legalMoves(g, g.turn);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: 'play', tile: [6, 6] });
    for (const s of [0, 1, 2, 3] as Seat[]) if (s !== g.turn) expect(legalMoves(g, s)).toHaveLength(0);
  });

  it('scores capicúa when the last tile fits both ends, and tallies it', () => {
    const s = stateWith([[[3, 5]], [[0, 0]], [[1, 1]], [[2, 2]]], [[3, 4], [4, 5]], 0);
    const r = applyMove(s, { type: 'play', tile: [3, 5], side: 'L' });
    expect(r.handResult).toMatchObject({ kind: 'domino', capicua: true, bonus: 25, points: 6, total: 31, side: 0 });
    expect(r.scores).toEqual([31, 0]);
    expect(r.tally.capicuas).toEqual([1, 0]);
  });

  it('counts every tile left on the table as the winners\' points', () => {
    const s = stateWith([[[5, 6]], [[6, 6]], [[4, 4]], [[1, 2]]], [[5, 3]], 0);
    const r = applyMove(s, { type: 'play', tile: [5, 6], side: 'L' });
    expect(r.handResult).toMatchObject({ kind: 'domino', capicua: false, points: 12 + 8 + 3 });
  });

  it('awards pase corrido when all three others pass', () => {
    const t = stateWith([[[1, 3], [2, 4]], [[6, 6], [5, 5]], [[6, 5], [4, 4]], [[5, 6], [4, 6]]], [[1, 2]], 0);
    let u = applyMove(t, { type: 'play', tile: [1, 3], side: 'L' });
    u = applyMove(u, { type: 'pass' });
    u = applyMove(u, { type: 'pass' });
    u = applyMove(u, { type: 'pass' });
    expect(u.turn).toBe(0);
    expect(u.scores).toEqual([25, 0]);
    expect(u.events.at(-1)).toMatchObject({ kind: 'paseCorrido', seat: 0, points: 25 });
  });

  it('rejects passing when you have a play, and drawing without a pile', () => {
    const s = stateWith([[[1, 3]], [[6, 6]], [[4, 4]], [[5, 5]]], [[1, 2]], 0);
    expect(() => applyMove(s, { type: 'pass' })).toThrow();
    const p = stateWith([[[6, 6]], [[6, 5]], [[4, 4]], [[5, 5]]], [[1, 2]], 0);
    expect(forcedMove(p, 0)).toEqual({ type: 'pass' });
    expect(() => applyMove(p, { type: 'draw' })).toThrow();
  });

  it('tranque goes to the lowest count; a cross-team tie goes to la mano', () => {
    const blocked = stateWith(
      [[[5, 4], [1, 1]], [[0, 0], [0, 2]], [[6, 6], [0, 1]], [[2, 2], [0, 3]]],
      [[4, 5]], 0, { mano: 1 },
    );
    const u = applyMove(blocked, { type: 'play', tile: [5, 4], side: 'L' });
    expect(u.handResult).toMatchObject({ kind: 'tranque', winnerSeat: 1, side: 1, tieToMano: true, points: 24 });
    expect(u.tally.tranques).toEqual([0, 1]);
  });
});

describe('pase de salida (2v2)', () => {
  // Seat 0 opens with 1-3; seat 1 holds no 1 or 3.
  const opening = (seat2: Tile[], seat3: Tile[], rules?: Rules) =>
    stateWith([[[1, 3], [2, 2]], [[5, 5], [6, 6]], seat2, seat3], [], 0, rules ? { rules } : {});

  it('the next player can\'t follow the first tile: +30 to the team that opened', () => {
    let u = applyMove(opening([[1, 1]], [[4, 4]]), { type: 'play', tile: [1, 3], side: 'R' });
    u = applyMove(u, { type: 'pass' });
    expect(u.scores).toEqual([30, 0]);
    expect(u.events.at(-1)).toEqual({ kind: 'paseSalida', seat: 0, points: 30 });
    expect(u.turn).toBe(2);
  });

  it('only that first pass counts: the partner passing too, or a pass later in the hand, adds nothing', () => {
    let u = applyMove(opening([[5, 6], [4, 5]], [[1, 4], [0, 0]]), { type: 'play', tile: [1, 3], side: 'R' });
    u = applyMove(u, { type: 'pass' }); // seat 1: +30
    u = applyMove(u, { type: 'pass' }); // seat 2, the opener's partner
    expect(u.scores).toEqual([30, 0]);
    u = applyMove(u, { type: 'play', tile: [1, 4], side: 'L' }); // seat 3: ends 4 and 3
    u = applyMove(u, { type: 'pass' }); // seat 0 has 2-2, can't follow 4 or 3
    expect(u.scores).toEqual([30, 0]);
    expect(u.events.filter((e) => e.kind === 'paseSalida')).toHaveLength(1);
  });

  it('if everyone passes back to the opener, both count: 30 + 25', () => {
    // The opener keeps a 3-4 to follow up with, so the hand isn't blocked.
    const s = stateWith([[[1, 3], [3, 4]], [[5, 5], [6, 6]], [[5, 6]], [[4, 6]]], [], 0);
    let u = applyMove(s, { type: 'play', tile: [1, 3], side: 'R' });
    for (let i = 0; i < 3; i++) u = applyMove(u, { type: 'pass' });
    expect(u.turn).toBe(0);
    expect(u.scores).toEqual([55, 0]);
    expect(u.events.filter((e) => e.kind === 'paseSalida' || e.kind === 'paseCorrido').map((e) => e.kind)).toEqual(['paseSalida', 'paseCorrido']);
  });

  it('off when the table turned it off, and on tables made before the rule existed', () => {
    const { paseSalidaBonus: _, ...older } = CLASSIC_DR;
    for (const rules of [{ ...CLASSIC_DR, paseSalidaBonus: 0 }, older]) {
      let u = applyMove(opening([[1, 1]], [[4, 4]], rules), { type: 'play', tile: [1, 3], side: 'R' });
      u = applyMove(u, { type: 'pass' });
      expect(u.scores).toEqual([0, 0]);
      expect(u.events.some((e) => e.kind === 'paseSalida')).toBe(false);
    }
  });
});

describe('1v1 with robar', () => {
  it('deals 7 each and leaves 14 in the pile; the highest double opens', () => {
    const g = newGame(seeded(3), rulesOf('1v1'));
    expect(g.hands).toHaveLength(2);
    expect(g.hands.map((h) => h.length)).toEqual([7, 7]);
    expect(g.boneyard).toHaveLength(14);
    expect(g.scores).toEqual([0, 0]);
    const doubles = g.hands.flat().filter((t) => t[0] === t[1]);
    if (doubles.length) {
      const top = Math.max(...doubles.map((t) => t[0]));
      expect(g.mustOpen).toEqual([top, top]);
      expect(legalMoves(g, g.turn)).toEqual([{ type: 'play', tile: [top, top], side: 'R' }]);
    }
  });

  it('draws until you can play, then you play; pass only once the pile is empty', () => {
    const s = stateWith([[[6, 6]], [[0, 0], [1, 1]]], [[2, 3]], 0, {
      rules: rulesOf('1v1'), boneyard: [[4, 5], [3, 6], [0, 1]],
    });
    expect(forcedMove(s, 0)).toEqual({ type: 'draw' });
    expect(() => applyMove(s, { type: 'pass' })).toThrow();
    let r = applyMove(s, { type: 'draw' }); // 4-5, still nothing
    expect(r.turn).toBe(0);
    expect(r.hands[0]).toEqual([[4, 5], [6, 6]]);
    r = applyMove(r, { type: 'draw' }); // 3-6 fits the 3
    expect(forcedMove(r, 0)).toBeNull();
    r = applyMove(r, { type: 'play', tile: [3, 6], side: 'R' });
    expect(r.turn).toBe(1);
    expect(r.boneyard).toEqual([[0, 1]]);
  });

  it('is not a tranque while the pile still has a matching tile', () => {
    // Ends 2|6 after the play; neither hand fits but the pile holds 2-4.
    const s = stateWith([[[3, 6], [0, 0]], [[1, 1]]], [[2, 3]], 0, { rules: rulesOf('1v1'), boneyard: [[2, 4]] });
    const r = applyMove(s, { type: 'play', tile: [3, 6], side: 'R' });
    expect(r.handResult).toBeNull();
    expect(forcedMove(r, 1)).toEqual({ type: 'draw' });
  });

  it('pase corrido needs just the one opponent to pass', () => {
    const s = stateWith([[[1, 3], [3, 4]], [[6, 6]]], [[1, 2]], 0, { rules: rulesOf('1v1') });
    let r = applyMove(s, { type: 'play', tile: [1, 3], side: 'L' }); // ends 3|2
    r = applyMove(r, { type: 'pass' });
    expect(r.turn).toBe(0);
    expect(r.scores).toEqual([25, 0]);
  });
});

describe('free-for-all', () => {
  it('scores each player on their own and the winner takes everyone\'s tiles', () => {
    const s = stateWith([[[5, 6]], [[6, 6]], [[4, 4]], [[1, 2]]], [[5, 3]], 0, { rules: rulesOf('ffa') });
    const r = applyMove(s, { type: 'play', tile: [5, 6], side: 'L' });
    expect(r.scores).toEqual([23, 0, 0, 0]);
    expect(r.handResult?.side).toBe(0);
  });

  it('a tranque tie not involving la mano goes to the first tied player after her', () => {
    // Seat 0 plays 5-4 → ends 5|5 and nobody holds a 5 → tranque.
    const b = stateWith(
      [[[5, 4], [6, 6]], [[0, 0], [0, 2]], [[6, 4], [0, 1]], [[1, 1]]],
      [[4, 5]], 0, { rules: rulesOf('ffa'), mano: 0 },
    );
    const r = applyMove(b, { type: 'play', tile: [5, 4], side: 'L' });
    // Counts: 12, 2, 11, 2 → seats 1 and 3 tie; la mano (0) isn't tied → seat 1, first after her.
    expect(r.handResult).toMatchObject({ kind: 'tranque', winnerSeat: 1, side: 1, tieToMano: true });
  });
});

describe('bots finish full games in every mode', () => {
  for (const mode of ['1v1', '2v2', 'ffa'] as Mode[]) {
    it(mode, () => {
      for (let g = 0; g < 120; g++) {
        const rng = seeded(g * 7 + mode.length);
        let s = newGame(rng, rulesOf(mode, 100));
        let guard = 0;
        while (s.winner === null) {
          if (s.handResult) {
            s = nextHand(s, rng);
            continue;
          }
          const inPlay = s.hands.reduce((n, h) => n + h.length, 0) + s.line.length + s.boneyard.length;
          expect(inPlay).toBe(28);
          s = applyMove(s, chooseMove(s, s.turn, rng));
          if (++guard > 20000) throw new Error('game did not terminate');
        }
        expect(s.hands).toHaveLength(playerCount(mode));
        expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(100);
        expect(s.scores[s.winner]).toBe(Math.max(...s.scores));
        for (let i = 1; i < s.line.length; i++) expect(s.line[i].a).toBe(s.line[i - 1].b);
        expect(s.tally.hands.reduce((a, b) => a + b, 0)).toBe(s.handNo);
      }
      expect(handCount([])).toBe(0);
    });
  }
});

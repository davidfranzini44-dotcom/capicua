import { describe, expect, it } from 'vitest';
import { applyMove, arcadeRules, type GameState, type Seat, type Tile } from '../supabase/functions/_shared/domino.ts';
import { draftPickSide, draftTapTile, draftView, startDraft, type Draft } from '../src/lib/powerDraft.ts';

function arcadeWith(hands: Tile[][], line: [number, number][], turn: Seat): GameState {
  return {
    rules: arcadeRules(), scores: [0, 0], handNo: 2, hands, boneyard: [],
    line: line.map(([a, b]) => ({ a, b, seat: 0 as Seat })), origin: 0,
    mano: 0, turn, lastPlayer: 0, passesSinceLastPlay: 0, mustOpen: null,
    voids: hands.map(() => []), events: [], handResult: null, winner: null,
    tally: { capicuas: [0, 0], tranques: [0, 0], hands: [0, 0] },
    arcade: { charges: [2, 2, 2, 2], lock: null, powerUsed: false, passes: 0 },
  };
}

describe('choosing a power step by step', () => {
  const s = arcadeWith([[[4, 6], [2, 6], [0, 0], [1, 5]], [[0, 1], [3, 3]], [[0, 2]], [[0, 3], [1, 1]]], [[1, 4]], 0);

  it('Cambio: ficha → rival → confirm; only opponents are offered', () => {
    let d: Draft = startDraft('cambio');
    expect(draftView(s, 0, d).step).toBe('tile');
    d = draftTapTile(s, 0, d, [0, 0]);
    const v = draftView(s, 0, d);
    expect(v.step).toBe('target');
    expect(v.targets).toEqual([1, 3]);
    d = { ...d, target: 3 } as Draft;
    expect(draftView(s, 0, d).move).toEqual({ type: 'cambio', tile: [0, 0], target: 3 });
  });

  it('Doble golpe: first placement, the board preview updates, second placement, one move', () => {
    let d: Draft = startDraft('doble');
    const v0 = draftView(s, 0, d);
    expect(v0.part).toBe(1);
    // 1-5 fits the 1 (left) with 5 out, then nothing else fits → not a first; 4-6 on the right leaves 6 for 2-6.
    expect(v0.tiles.some(([a, b]) => a === 4 && b === 6)).toBe(true);
    d = draftTapTile(s, 0, d, [4, 6]);
    const v1 = draftView(s, 0, d);
    expect(v1.part).toBe(2);
    expect(v1.ghosts).toEqual(['4-6']);
    expect(v1.line.map((p) => [p.a, p.b])).toEqual([[1, 4], [4, 6]]);
    d = draftTapTile(s, 0, d, [2, 6]);
    const v2 = draftView(s, 0, d);
    expect(v2.step).toBe('confirm');
    expect(v2.move).toEqual({ type: 'doble', first: { tile: [4, 6], side: 'R' }, second: { tile: [2, 6], side: 'R' } });
    expect(() => applyMove(s, v2.move!)).not.toThrow();
  });

  it('Comodín: skips questions with a single answer, then asks which half connects', () => {
    let d: Draft = startDraft('comodin');
    d = draftTapTile(s, 0, d, [2, 6]);
    expect(draftView(s, 0, d).step).toBe('side');
    d = draftPickSide(s, 0, d, 'R'); // the 4: either the 2 or the 6 can become a 4
    const v = draftView(s, 0, d);
    expect(v.step).toBe('half');
    expect(v.halves).toEqual([{ half: 0, becomes: [4, 6] }, { half: 1, becomes: [4, 2] }]);
    d = { ...d, half: 1 } as Draft;
    const done = draftView(s, 0, d);
    expect(done.move).toEqual({ type: 'comodin', tile: [2, 6], side: 'R', half: 1 });
    expect(done.line.at(-1)).toMatchObject({ a: 4, b: 2, wild: 'a', phys: [2, 6] });
  });

  it('Candado: a normal play, then which end of the new board to close', () => {
    let d: Draft = startDraft('candado');
    d = draftTapTile(s, 0, d, [4, 6]);
    const v = draftView(s, 0, d);
    expect(v.step).toBe('lock');
    expect(v.locks).toEqual([{ side: 'L', value: 1 }, { side: 'R', value: 6 }]);
    d = { ...d, lock: 'R' } as Draft;
    expect(draftView(s, 0, d).move).toEqual({ type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
  });

  it('tapping a ficha that can\'t be used changes nothing; tapping the picked one again un-picks it', () => {
    let d: Draft = startDraft('candado');
    expect(draftTapTile(s, 0, d, [0, 0])).toEqual(d);
    d = draftTapTile(s, 0, startDraft('cambio'), [0, 0]);
    expect(draftTapTile(s, 0, d, [0, 0])).toEqual({ power: 'cambio' });
  });
});

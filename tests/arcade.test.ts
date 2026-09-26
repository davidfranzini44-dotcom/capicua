import { describe, expect, it } from 'vitest';
import {
  applyMove, ARCADE, arcadeRules, canRescue, comodinOptions, dobleSequences, forcedMove, fullSet, legalMoves, newGame, nextHand,
  physOf, powerBlock, sameTile, type GameState, type Move, type Seat, type Tile,
} from '../supabase/functions/_shared/domino.ts';
import { chooseArcadeMove } from '../supabase/functions/_shared/bot.ts';
import { autoAction, autoDelay, publicState, TIMING, type SeatInfo } from '../supabase/functions/_shared/table.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** A mid-hand Arcade state with chosen hands and board (values as seen left → right). */
function arcadeWith(hands: Tile[][], line: [number, number][], turn: Seat, extra: Partial<GameState> = {}): GameState {
  const { arcade, ...rest } = extra;
  return {
    rules: arcadeRules(), scores: [0, 0], handNo: 2, hands, boneyard: [],
    line: line.map(([a, b]) => ({ a, b, seat: 0 as Seat })), origin: 0,
    mano: 0, turn, lastPlayer: 0, passesSinceLastPlay: 0, mustOpen: null,
    voids: hands.map(() => []), events: [], handResult: null, winner: null,
    tally: { capicuas: [0, 0], tranques: [0, 0], hands: [0, 0] },
    arcade: { charges: [2, 2, 2, 2], lock: null, powerUsed: false, passes: 0, ...arcade },
    ...rest,
  };
}

/** Every physical ficha sits in exactly one place: a hand, the board or the pile. */
function physicalTiles(s: GameState): string[] {
  const all = [...s.hands.flat(), ...s.line.map(physOf), ...s.boneyard];
  return all.map(([a, b]) => `${a}-${b}`).sort();
}
const FULL = fullSet().map(([a, b]) => `${a}-${b}`).sort();

const humans: SeatInfo[] = [0, 1, 2, 3].map((s) => ({ seat: s as Seat, userId: `u${s}`, name: `P${s}`, isBot: false, away: false }));
const bots: SeatInfo[] = [0, 1, 2, 3].map((s) => ({ seat: s as Seat, userId: null, name: `B${s}`, isBot: true, away: false }));

describe('Arcade: match and charges', () => {
  it('starts with no powers (they are earned), 2v2, first to three stars, no bonus points', () => {
    const g = newGame(seeded(1), arcadeRules());
    expect(g.arcade).toMatchObject({ charges: [0, 0, 0, 0], lock: null, powerUsed: false, passes: 0 });
    expect(g.rules).toMatchObject({ mode: '2v2', target: 3, capicuaBonus: 0, paseCorridoBonus: 0, ruleset: 'arcade' });
  });

  it('no powers before the hand has been opened', () => {
    const g = newGame(seeded(2), arcadeRules());
    expect(powerBlock(g, g.turn, 'cambio')).toBe('opening');
  });

  it('a won hand is one star; charges carry over to the next hand; a new match resets them', () => {
    const s = arcadeWith([[[3, 5], [1, 1]], [[0, 0], [2, 2]], [[1, 2], [2, 3]], [[4, 4], [6, 6]]], [[3, 4], [4, 5]], 0);
    let r = applyMove(s, { type: 'cambio', tile: [1, 1], target: 1 }, () => 0); // gets 0-0 from seat 1
    expect(r.arcade!.charges).toEqual([1, 2, 2, 2]);
    // Seat 0 now holds [0-0, 3-5] and plays on.
    r = applyMove(r, { type: 'play', tile: [3, 5], side: 'L' });
    expect(r.handResult).toBeNull();
    // Finish a hand directly: seat 1 plays its last ficha.
    const last = arcadeWith([[[0, 0], [1, 2]], [[5, 6]], [[2, 2], [2, 3]], [[4, 4], [6, 6]]], [[3, 4], [4, 5]], 1, { arcade: { charges: [1, 0, 2, 2], lock: null, powerUsed: false, passes: 0 } });
    const won = applyMove(last, { type: 'play', tile: [5, 6], side: 'R' });
    expect(won.handResult).toMatchObject({ kind: 'domino', side: 1, points: 1, bonus: 0, total: 1 });
    expect(won.scores).toEqual([0, 1]);
    // The losing team (seats 0 and 2) earns one each — seat 2 is already at the limit of two.
    expect(won.arcade!.charges).toEqual([2, 0, 2, 2]);
    const next = nextHand(won, seeded(3));
    expect(next.arcade!.charges).toEqual([2, 0, 2, 2]);
    expect(next.arcade).toMatchObject({ lock: null, powerUsed: false, passes: 0 });
    expect(next.turn).toBe(1); // the winner opens
    expect(newGame(seeded(4), arcadeRules()).arcade!.charges).toEqual([0, 0, 0, 0]);
  });

  it('capicúa is celebrated but still worth just one star', () => {
    const s = arcadeWith([[[3, 5]], [[0, 0]], [[1, 1]], [[2, 2]]], [[3, 4], [4, 5]], 0);
    const r = applyMove(s, { type: 'play', tile: [3, 5], side: 'L' });
    expect(r.handResult).toMatchObject({ capicua: true, bonus: 0, total: 1 });
    expect(r.scores).toEqual([1, 0]);
    expect(r.tally.capicuas).toEqual([1, 0]);
  });

  it('the third star wins the match', () => {
    const s = arcadeWith([[[5, 6]], [[0, 0]], [[1, 1]], [[2, 2]]], [[3, 5]], 0, { scores: [2, 1] });
    const r = applyMove(s, { type: 'play', tile: [5, 6], side: 'R' });
    expect(r.scores).toEqual([3, 1]);
    expect(r.winner).toBe(0);
  });

  it('one power per turn, and none once the charges are gone', () => {
    const s = arcadeWith([[[1, 2], [3, 3], [6, 6]], [[0, 0], [4, 4]], [[0, 1]], [[5, 5], [2, 2]]], [[1, 4]], 0);
    const r = applyMove(s, { type: 'cambio', tile: [6, 6], target: 1 }, () => 0);
    expect(powerBlock(r, 0, 'cambio')).toBe('power_used');
    expect(() => applyMove(r, { type: 'cambio', tile: [3, 3], target: 3 })).toThrow();
    const empty = arcadeWith(s.hands, [[1, 4]], 0, { arcade: { charges: [0, 2, 2, 2], lock: null, powerUsed: false, passes: 0 } });
    expect(powerBlock(empty, 0, 'cambio')).toBe('no_charges');
  });
});

describe('Arcade: Cambio', () => {
  const s = arcadeWith([[[1, 2], [3, 3]], [[0, 0], [4, 4], [5, 6]], [[0, 1]], [[5, 5], [2, 2]]], [[1, 4]], 0, {
    voids: [[6], [2], [], [3]],
  });

  it('swaps my chosen ficha for a random one of the opponent\'s, same sizes, my turn goes on', () => {
    const r = applyMove(s, { type: 'cambio', tile: [3, 3], target: 1 }, () => 0.99); // their last ficha: 5-6
    expect(r.hands[0]).toEqual([[1, 2], [5, 6]]);
    expect(r.hands[1]).toEqual([[0, 0], [3, 3], [4, 4]]);
    expect(r.turn).toBe(0);
    expect(r.arcade!.powerUsed).toBe(true);
    expect(physicalTiles({ ...r, hands: [...r.hands] })).toEqual(physicalTiles(s));
  });

  it('forgets what passing had shown about both hands', () => {
    const r = applyMove(s, { type: 'cambio', tile: [3, 3], target: 1 }, () => 0);
    expect(r.voids).toEqual([[], [], [], [3]]);
  });

  it('never tells the table which fichas moved', () => {
    const r = applyMove(s, { type: 'cambio', tile: [3, 3], target: 1 }, () => 0);
    const ev = r.events.at(-1)!;
    expect(ev).toEqual({ kind: 'power', seat: 0, power: 'cambio', target: 1 });
    expect(Object.keys(publicState(r))).not.toContain('hands');
  });

  it('only an opponent can be the target, and only with a ficha I hold', () => {
    expect(() => applyMove(s, { type: 'cambio', tile: [3, 3], target: 2 })).toThrow(); // partner
    expect(() => applyMove(s, { type: 'cambio', tile: [3, 3], target: 0 })).toThrow(); // me
    expect(() => applyMove(s, { type: 'cambio', tile: [6, 6], target: 1 })).toThrow(); // not mine
  });

  it('works with a single ficha left, and I may win with what I got', () => {
    const one = arcadeWith([[[3, 3]], [[1, 6]], [[0, 0]], [[2, 2], [2, 5]]], [[1, 4]], 0);
    let r = applyMove(one, { type: 'cambio', tile: [3, 3], target: 1 }, () => 0);
    expect(r.hands[0]).toEqual([[1, 6]]);
    r = applyMove(r, { type: 'play', tile: [1, 6], side: 'L' });
    expect(r.handResult).toMatchObject({ kind: 'domino', winnerSeat: 0 });
  });

  it('a failed attempt changes nothing and costs nothing', () => {
    const copy = structuredClone(s);
    expect(() => applyMove(s, { type: 'cambio', tile: [3, 3], target: 2 })).toThrow();
    expect(s).toEqual(copy);
  });
});

describe('Arcade: Doble golpe', () => {
  const s = arcadeWith([[[4, 6], [6, 2], [0, 0]].map(([a, b]) => (a <= b ? [a, b] : [b, a]) as Tile), [[0, 1]], [[0, 2]], [[0, 3]]], [[1, 4]], 0);

  it('places two fichas in one turn, each matching the board it finds, for one charge', () => {
    const r = applyMove(s, { type: 'doble', first: { tile: [4, 6], side: 'R' }, second: { tile: [2, 6], side: 'R' } });
    expect(r.line.map((p) => [p.a, p.b])).toEqual([[1, 4], [4, 6], [6, 2]]);
    expect(r.hands[0]).toEqual([[0, 0]]);
    expect(r.arcade!.charges[0]).toBe(1);
    expect(r.turn).toBe(1);
    expect(r.events.map((e) => e.kind)).toEqual(['power', 'play', 'play']);
  });

  it('needs three fichas, a real sequence, and can\'t be used to go out', () => {
    const two = arcadeWith([[[4, 6], [2, 6]], [[0, 1]], [[0, 2]], [[0, 3]]], [[1, 4]], 0);
    expect(powerBlock(two, 0, 'doble')).toBe('need3');
    const none = arcadeWith([[[4, 5], [0, 0], [1, 1]], [[0, 1]], [[0, 2]], [[0, 3]]], [[2, 3]], 0);
    expect(powerBlock(none, 0, 'doble')).toBe('no_sequence');
  });

  it('checks the whole sequence first: an impossible second placement changes nothing', () => {
    const copy = structuredClone(s);
    expect(() => applyMove(s, { type: 'doble', first: { tile: [4, 6], side: 'R' }, second: { tile: [0, 0], side: 'R' } })).toThrow();
    expect(s).toEqual(copy);
  });

  it('both placements respect a Candado lock', () => {
    const locked = { ...structuredClone(s), arcade: { charges: [2, 2, 2, 2], lock: { side: 'R' as const, seat: 0 as Seat }, powerUsed: false, passes: 0 } };
    expect(dobleSequences(locked, 0).every((q) => q.first.side === 'L' && q.second.side === 'L')).toBe(true);
  });
});

describe('Arcade: Comodín', () => {
  // The board's right end shows 6; I hold 2-4.
  const s = arcadeWith([[[2, 4], [0, 1]], [[0, 0]], [[1, 1]], [[3, 3]]], [[5, 6]], 0);

  it('turns only the connecting half into the number the end needs; the other half faces out', () => {
    const r = applyMove(s, { type: 'comodin', tile: [2, 4], side: 'R', half: 0 });
    const placed = r.line.at(-1)!;
    expect([placed.a, placed.b]).toEqual([6, 4]);
    expect(placed).toMatchObject({ wild: 'a', phys: [2, 4] });
    expect(r.hands[0]).toEqual([[0, 1]]);
    expect(r.turn).toBe(1);
    expect(r.events.at(-2)).toMatchObject({ kind: 'power', power: 'comodin', tile: [2, 4], from: 2, to: 6 });
    // The next player plays against the 4 that faces out.
    expect(legalMoves({ ...r, hands: [[], [[4, 4]], [], []] } as GameState, 1)).toContainEqual({ type: 'play', tile: [4, 4], side: 'R' });
    expect(physicalTiles(r)).toEqual(physicalTiles(s));
  });

  it('works on the left end too, marking the right half as changed', () => {
    const r = applyMove(s, { type: 'comodin', tile: [2, 4], side: 'L', half: 1 }); // 4 becomes 5, 2 faces out
    expect(r.line[0]).toMatchObject({ a: 2, b: 5, wild: 'b', phys: [2, 4] });
    expect(r.origin).toBe(1);
  });

  it('must change something, needs two fichas, and never plays the last one', () => {
    const same = arcadeWith([[[6, 1], [0, 0]].map(([a, b]) => (a <= b ? [a, b] : [b, a]) as Tile), [[0, 1]], [[1, 1]], [[3, 3]]], [[5, 6]], 0);
    expect(comodinOptions(same, 0).some((o) => sameTile(o.tile, [1, 6]) && o.side === 'R' && o.half === 1)).toBe(false); // 6 already fits
    expect(() => applyMove(same, { type: 'comodin', tile: [1, 6], side: 'R', half: 1 })).toThrow();
    const last = arcadeWith([[[2, 4]], [[0, 0]], [[1, 1]], [[3, 3]]], [[5, 6]], 0);
    expect(powerBlock(last, 0, 'comodin')).toBe('need2');
  });

  it('keeps physical identity: an effective copy on the board is allowed, a lost or doubled ficha is not', () => {
    const r = applyMove(s, { type: 'comodin', tile: [2, 4], side: 'R', half: 1 }); // the 4 becomes 6, the 2 faces out
    expect(r.line.at(-1)).toMatchObject({ a: 6, b: 2, phys: [2, 4] });
    expect(physicalTiles(r)).toEqual(physicalTiles(s));
  });

  it('can\'t use a locked end', () => {
    const locked = { ...structuredClone(s), arcade: { charges: [2, 2, 2, 2], lock: { side: 'R' as const, seat: 0 as Seat }, powerUsed: false, passes: 0 } };
    expect(comodinOptions(locked, 0).every((o) => o.side === 'L')).toBe(true);
    expect(() => applyMove(locked, { type: 'comodin', tile: [2, 4], side: 'R', half: 0 })).toThrow();
  });
});

describe('Arcade: Candado', () => {
  const s = arcadeWith([[[4, 6], [1, 1]], [[1, 3], [6, 6]], [[0, 0]], [[3, 3]]], [[1, 4]], 0);

  it('plays normally and closes the chosen end for the next player only', () => {
    const r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    expect(r.arcade!.lock).toEqual({ side: 'R', seat: 1 });
    expect(r.arcade!.charges[0]).toBe(1);
    expect(legalMoves(r, 1)).toEqual([{ type: 'play', tile: [1, 3], side: 'L' }]); // 6-6 would need the locked 6
    expect(r.events.at(-1)).toMatchObject({ kind: 'power', power: 'candado', side: 'R', target: 1 });
  });

  it('the lock ends with that player\'s turn: after a play…', () => {
    let r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    r = applyMove(r, { type: 'play', tile: [1, 3], side: 'L' });
    expect(r.arcade!.lock).toBeNull();
  });

  it('…after a pass, which also doesn\'t count towards a blocked hand', () => {
    const t = arcadeWith([[[4, 6], [1, 1]], [[6, 6], [5, 5]], [[0, 0]], [[3, 3]]], [[1, 4]], 0, { arcade: { charges: [2, 0, 2, 2], lock: null, powerUsed: false, passes: 2 } });
    let r = applyMove(t, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    expect(forcedMove(r, 1)).toEqual({ type: 'pass' });
    r = applyMove(r, { type: 'pass' });
    expect(r.arcade).toMatchObject({ lock: null, passes: 0 });
    expect(r.voids[1]).toEqual([1]); // only the open end is known to be missing
  });

  it('…and after a timeout (the server plays an ordinary move for them)', () => {
    const r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    const act = autoAction(r, humans, 15_000, 0, 16_000);
    expect(act).toMatchObject({ kind: 'move', strike: true });
    const after = applyMove(r, (act as { move: Move }).move);
    expect(after.arcade!.lock).toBeNull();
  });

  it('a locked player may lock the next one: the old lock goes, the new one applies', () => {
    const t = arcadeWith([[[4, 6], [1, 1]], [[1, 3], [2, 2]], [[0, 0], [3, 5]], [[3, 3]]], [[1, 4]], 0);
    let r = applyMove(t, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    r = applyMove(r, { type: 'play', tile: [1, 3], side: 'L', lock: 'L' });
    expect(r.arcade!.lock).toEqual({ side: 'L', seat: 2 });
  });

  it('with the same number on both ends, the open end is still offered', () => {
    const t = arcadeWith([[[1, 1]], [[2, 2], [2, 5]], [[0, 0]], [[3, 3]]], [[2, 4], [4, 2]], 1, { arcade: { charges: [2, 2, 2, 2], lock: { side: 'L', seat: 1 }, powerUsed: false, passes: 0 } });
    expect(legalMoves(t, 1)).toEqual([{ type: 'play', tile: [2, 2], side: 'R' }, { type: 'play', tile: [2, 5], side: 'R' }]);
  });

  it('can\'t go with the last ficha, and needs a real play', () => {
    const last = arcadeWith([[[4, 6]], [[1, 3]], [[0, 0]], [[3, 3]]], [[1, 4]], 0);
    expect(powerBlock(last, 0, 'candado')).toBe('need2');
    expect(() => applyMove(s, { type: 'play', tile: [1, 1], side: 'R', lock: 'L' })).toThrow(); // 1-1 doesn't fit the 4
  });
});

describe('Arcade: earning powers', () => {
  const none = { charges: [0, 0, 0, 0], lock: null, powerUsed: false, passes: 0 };

  it('your play leaves the next rival without a play → you earn one', () => {
    const s = arcadeWith([[[4, 6], [1, 1]], [[0, 0], [2, 3]], [[5, 5]], [[3, 3]]], [[1, 4]], 0, { arcade: { ...none } });
    let r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R' }); // ends 1 and 6: seat 1 has neither
    expect(forcedMove(r, 1)).toEqual({ type: 'pass' });
    r = applyMove(r, { type: 'pass' });
    expect(r.arcade!.charges).toEqual([1, 0, 0, 0]);
    expect(r.events.at(-1)).toEqual({ kind: 'earn', seat: 0, reason: 'block' });
  });

  it('only the pass right after your play counts', () => {
    const s = arcadeWith([[[4, 6], [1, 1]], [[0, 0], [2, 3]], [[5, 5]], [[3, 3]]], [[1, 4]], 0, { arcade: { ...none } });
    let r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R' });
    r = applyMove(r, { type: 'pass' }); // seat 1 → seat 0 earns
    r = applyMove(r, { type: 'pass' }); // seat 2 passes too, but seat 1 made no play
    expect(r.arcade!.charges).toEqual([1, 0, 0, 0]);
  });

  it('a pass forced by your Candado earns nothing extra', () => {
    const s = arcadeWith([[[4, 6], [1, 1]], [[6, 6], [5, 5]], [[0, 0]], [[3, 3]]], [[1, 4]], 0, { arcade: { ...none, charges: [1, 0, 0, 0] } });
    let r = applyMove(s, { type: 'play', tile: [4, 6], side: 'R', lock: 'R' });
    r = applyMove(r, { type: 'pass' });
    expect(r.arcade!.charges).toEqual([0, 0, 0, 0]);
  });

  it('never more than two held', () => {
    const s = arcadeWith([[[4, 6], [1, 1]], [[0, 0], [2, 3]], [[5, 5]], [[3, 3]]], [[1, 4]], 0, { arcade: { ...none, charges: [2, 0, 0, 0] } });
    const r = applyMove(applyMove(s, { type: 'play', tile: [4, 6], side: 'R' }), { type: 'pass' });
    expect(r.arcade!.charges[0]).toBe(2);
    expect(r.events.some((e) => e.kind === 'earn')).toBe(false);
  });

  it('the team that loses a hand earns one each (a comeback boost); not when the match is over', () => {
    const s = arcadeWith([[[5, 6]], [[0, 0]], [[1, 1]], [[2, 2]]], [[3, 5]], 0, { arcade: { ...none } });
    const r = applyMove(s, { type: 'play', tile: [5, 6], side: 'R' });
    expect(r.arcade!.charges).toEqual([0, 1, 0, 1]);
    expect(r.events.filter((e) => e.kind === 'earn')).toEqual([
      { kind: 'earn', seat: 1, reason: 'comeback' }, { kind: 'earn', seat: 3, reason: 'comeback' },
    ]);
    const last = arcadeWith([[[5, 6]], [[0, 0]], [[1, 1]], [[2, 2]]], [[3, 5]], 0, { arcade: { ...none }, scores: [2, 0] });
    expect(applyMove(last, { type: 'play', tile: [5, 6], side: 'R' }).arcade!.charges).toEqual([0, 0, 0, 0]);
  });

  it('with no powers, a stuck player just passes as usual', () => {
    const s = arcadeWith([[[0, 0], [2, 3]], [[1, 1]], [[2, 2]], [[3, 3]]], [[5, 6]], 0, { arcade: { ...none } });
    expect(canRescue(s, 0)).toBe(false);
    expect(powerBlock(s, 0, 'cambio')).toBe('no_charges');
  });
});

describe('Arcade: passing and blocked hands', () => {
  it('no passing while an ordinary play exists', () => {
    const s = arcadeWith([[[4, 6], [0, 0]], [[1, 1]], [[2, 2]], [[3, 3]]], [[1, 4]], 0);
    expect(() => applyMove(s, { type: 'pass' })).toThrow();
  });

  it('stuck with a power left: the player gets the whole turn, and a timeout passes without spending it', () => {
    const s = arcadeWith([[[0, 0], [2, 3]], [[1, 1]], [[2, 2]], [[3, 3]]], [[5, 6]], 0);
    expect(canRescue(s, 0)).toBe(true);
    expect(autoDelay(s, humans, 15_000)).toBe(15_000);
    expect(autoAction(s, humans, 15_000, 0, 1_500)).toBeNull();
    const act = autoAction(s, humans, 15_000, 0, 15_001);
    expect(act).toEqual({ kind: 'move', move: { type: 'pass' }, strike: false });
    expect(applyMove(s, { type: 'pass' }).arcade!.charges[0]).toBe(2);
  });

  it('stuck with nothing left: the usual quick automatic pass', () => {
    const s = arcadeWith([[[0, 0], [2, 3]], [[1, 1]], [[2, 2]], [[3, 3]]], [[5, 6]], 0, { arcade: { charges: [0, 2, 2, 2], lock: null, powerUsed: false, passes: 0 } });
    expect(canRescue(s, 0)).toBe(false);
    expect(autoDelay(s, humans, 15_000)).toBe(TIMING.autoPassMs);
  });

  it('after a Cambio that doesn\'t help, the only thing left is to pass', () => {
    const s = arcadeWith([[[0, 0], [2, 3]], [[1, 1], [2, 2]], [[2, 4]], [[3, 3]]], [[5, 6]], 0);
    const r = applyMove(s, { type: 'cambio', tile: [2, 3], target: 1 }, () => 0); // gets 1-1: still stuck
    expect(legalMoves(r, 0)).toEqual([]);
    expect(canRescue(r, 0)).toBe(false);
    expect(forcedMove(r, 0)).toEqual({ type: 'pass' });
  });

  it('four unrestricted passes in a row block the hand (lowest count wins, physical values)', () => {
    let s = arcadeWith([[[0, 0], [2, 3]], [[1, 1], [2, 2]], [[2, 4], [3, 3]], [[1, 2]]], [[5, 6]], 0, {
      arcade: { charges: [0, 0, 0, 0], lock: null, powerUsed: false, passes: 0 },
    });
    for (let i = 0; i < 3; i++) s = applyMove(s, { type: 'pass' });
    expect(s.handResult).toBeNull();
    s = applyMove(s, { type: 'pass' });
    expect(s.handResult).toMatchObject({ kind: 'tranque', winnerSeat: 3, points: 1 });
    expect(s.scores).toEqual([0, 1]);
  });

  it('a successful Cambio resets the count', () => {
    let s = arcadeWith([[[0, 0], [2, 3]], [[1, 1], [2, 2]], [[2, 4], [3, 3]], [[1, 2]]], [[5, 6]], 3, {
      arcade: { charges: [2, 0, 0, 0], lock: null, powerUsed: false, passes: 3 },
    });
    s = applyMove(s, { type: 'pass' }); // 4th in a row → blocked
    expect(s.handResult?.kind).toBe('tranque');
    let t = arcadeWith([[[0, 0], [2, 3]], [[1, 1], [2, 2]], [[2, 4], [3, 3]], [[1, 2]]], [[5, 6]], 0, {
      arcade: { charges: [2, 0, 0, 0], lock: null, powerUsed: false, passes: 3 },
    });
    t = applyMove(t, { type: 'cambio', tile: [0, 0], target: 1 }, () => 0);
    expect(t.arcade!.passes).toBe(0);
  });

  it('a locked pass then three ordinary passes brings the turn back, not a tranque', () => {
    let s = arcadeWith([[[0, 0]], [[1, 1], [6, 6]], [[2, 2]], [[3, 3]]], [[6, 5]], 1, {
      arcade: { charges: [0, 0, 0, 0], lock: { side: 'L', seat: 1 }, powerUsed: false, passes: 0 },
    });
    s = applyMove(s, { type: 'pass' }); // seat 1, locked out of the 6
    for (let i = 0; i < 3; i++) s = applyMove(s, { type: 'pass' });
    expect(s.handResult).toBeNull();
    expect(s.turn).toBe(1);
    expect(legalMoves(s, 1)).toContainEqual({ type: 'play', tile: [6, 6], side: 'L' });
  });
});

describe('Arcade: whole matches', () => {
  it('bots play complete matches: every power shows up, all 28 fichas stay put, three stars end it', () => {
    const used = new Set<string>();
    for (let game = 0; game < 30; game++) {
      const rng = seeded(1000 + game);
      let s = newGame(rng, arcadeRules());
      for (let guard = 0; guard < 5000 && s.winner === null; guard++) {
        if (s.handResult) {
          s = nextHand(s, rng);
          continue;
        }
        const move = chooseArcadeMove(s, s.turn, rng);
        if (move.type !== 'play' && move.type !== 'pass') used.add(move.type);
        if (move.type === 'play' && move.lock) used.add('candado');
        s = applyMove(s, move, rng);
        expect(physicalTiles(s)).toEqual(FULL);
        expect(s.arcade!.charges.every((c) => c >= 0 && c <= ARCADE.maxCharges)).toBe(true);
      }
      expect(s.winner).not.toBeNull();
      expect(Math.max(...s.scores)).toBe(3);
      // Charges only go down during a match.
      expect(s.arcade!.charges.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8);
    }
    expect([...used].sort()).toEqual(['cambio', 'candado', 'comodin', 'doble']);
  });

  it('public state never carries anyone\'s hand or the server\'s request ids', () => {
    const s = newGame(seeded(9), arcadeRules());
    s.arcade!.recent = ['abc'];
    const pub = publicState(s) as unknown as Record<string, unknown>;
    expect('hands' in pub).toBe(false);
    expect((pub.arcade as Record<string, unknown>).recent).toBeUndefined();
  });

  it('bots on the server use powers; people never have theirs spent for them', () => {
    const s = arcadeWith([[[0, 0], [2, 3]], [[1, 1]], [[2, 2]], [[3, 3]]], [[5, 6]], 0);
    const bot = autoAction(s, bots, 15_000, 0, 10_000);
    expect(bot && bot.kind === 'move' && bot.move.type).not.toBe('pass'); // a bot rescues itself with a power
    const person = autoAction(s, humans, 15_000, 0, 16_000);
    expect(person).toEqual({ kind: 'move', move: { type: 'pass' }, strike: false });
  });
});

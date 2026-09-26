import { describe, expect, it } from 'vitest';
import {
  bracketSize, firstRound, minEntries, nextMatch, noShowWinner, placementFor, prizes, roundCount, stage, validateTournament,
} from '../supabase/functions/_shared/tournament.ts';
import { roomCode, voiceRoomFor } from '../supabase/functions/_shared/table.ts';

/** Deterministic rng so shuffles are repeatable. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('bracket', () => {
  it('rounds the field up to a power of two', () => {
    expect([2, 3, 4, 5, 8, 9, 16].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16, 16]);
    expect([2, 4, 5, 16].map(roundCount)).toEqual([1, 2, 3, 4]);
  });

  it('draws every entry exactly once, and a bye never meets a bye', () => {
    for (let n = 2; n <= 16; n++) {
      const ids = Array.from({ length: n }, (_, i) => `e${i}`);
      const round = firstRound(ids, seeded(n));
      expect(round).toHaveLength(bracketSize(n) / 2);
      const drawn = round.flat().filter((x): x is string => x !== null);
      expect(drawn.sort()).toEqual([...ids].sort());
      expect(round.filter(([, b]) => b === null)).toHaveLength(bracketSize(n) - n);
      expect(round.every(([a]) => a !== null)).toBe(true);
    }
  });

  it('sends winners to the right slot of the next round', () => {
    expect(nextMatch(1, 0)).toEqual({ round: 2, slot: 0, side: 'a' });
    expect(nextMatch(1, 1)).toEqual({ round: 2, slot: 0, side: 'b' });
    expect(nextMatch(2, 5)).toEqual({ round: 3, slot: 2, side: 'b' });
  });

  it('places knocked-out entries by the round they fell in', () => {
    expect([3, 2, 1].map((r) => placementFor(r, 3))).toEqual([2, 3, 5]);
    expect(placementFor(1, 4)).toBe(9);
    expect([4, 3, 2, 1].map((r) => stage(r, 4))).toEqual(['final', 'semi', 'quarter', 'r16']);
  });

  it('needs at least four people: 4 players, or 2 pairs', () => {
    expect(minEntries('1v1')).toBe(4);
    expect(minEntries('2v2')).toBe(2);
  });
});

describe('no-shows', () => {
  it('the side with more players ready goes through; a tie is a coin flip', () => {
    expect(noShowWinner(1, 0)).toBe('a');
    expect(noShowWinner(1, 2)).toBe('b');
    expect(noShowWinner(0, 0, () => 0.2)).toBe('a');
    expect(noShowWinner(0, 0, () => 0.8)).toBe('b');
  });
});

describe('prizes', () => {
  it('pays 70/30 and splits inside a pair', () => {
    expect(prizes(1000, ['c'], ['r'])).toEqual([{ userId: 'c', amount: 700 }, { userId: 'r', amount: 300 }]);
    expect(prizes(1001, ['c1', 'c2'], ['r1', 'r2'])).toEqual([
      { userId: 'c1', amount: 350 }, { userId: 'c2', amount: 350 },
      { userId: 'r1', amount: 151 }, { userId: 'r2', amount: 150 },
    ]);
  });

  it('pays out the whole pot, to the chip', () => {
    const rng = seeded(7);
    for (let i = 0; i < 200; i++) {
      const pot = Math.floor(rng() * 200_000);
      const pairs = rng() < 0.5;
      const paid = prizes(pot, pairs ? ['a', 'b'] : ['a'], pairs ? ['c', 'd'] : ['c']);
      expect(paid.reduce((s, p) => s + p.amount, 0)).toBe(pot);
    }
  });

  it('free tournaments pay nothing', () => {
    expect(prizes(0, ['c'], ['r'])).toEqual([]);
  });
});

describe('settings', () => {
  const ok = { name: 'Torneo del barrio', mode: '2v2' as const, size: 8 as const, buyIn: 500, target: 100, turnSeconds: 25 };

  it('accepts sensible settings and tidies the name', () => {
    expect(validateTournament({ ...ok, name: '  Copa   Capicúa ' })).toMatchObject({ name: 'Copa Capicúa', size: 8 });
  });

  it('rejects anything else', () => {
    expect(validateTournament({ ...ok, name: 'ab' })).toBeNull();
    expect(validateTournament({ ...ok, size: 6 as 8 })).toBeNull();
    expect(validateTournament({ ...ok, mode: 'ffa' as '1v1' })).toBeNull();
    expect(validateTournament({ ...ok, buyIn: -5 })).toBeNull();
    expect(validateTournament({ ...ok, target: 120 })).toBeNull();
  });

  it('tournament codes are 5 letters (tables are 4), and the whole table can talk', () => {
    expect(roomCode(Math.random, 5)).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(voiceRoomFor('tournament', '2v2', 'ABCD', 1)).toBe('capicua-ABCD');
  });
});

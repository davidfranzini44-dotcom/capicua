import { describe, expect, it } from 'vitest';
import {
  afterFeeders, bracketSize, checkInOpen, firstRound, minEntries, nextMatch, noShowOutcome, placementFor, prizes, roundCount, stage, TOURNAMENT, validateTournament,
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
  it('someone on each side: the game is played (a missing partner is played by the server)', () => {
    expect(noShowOutcome(1, 1)).toBe('play');
    expect(noShowOutcome(1, 2)).toBe('play');
    expect(noShowOutcome(2, 1)).toBe('play');
  });

  it('only one side showed up: it goes through; nobody: both are out', () => {
    expect(noShowOutcome(1, 0)).toBe('a');
    expect(noShowOutcome(0, 2)).toBe('b');
    expect(noShowOutcome(0, 0)).toBe('none');
  });

  it('after a double no-show the other side of the next match goes straight on', () => {
    expect(afterFeeders('x', 'y')).toEqual({ play: ['x', 'y'] });
    expect(afterFeeders(null, 'y')).toEqual({ bye: 'y' });
    expect(afterFeeders('x', null)).toEqual({ bye: 'x' });
    expect(afterFeeders(null, null)).toBe('empty');
  });

  it('the Ready window is 3 minutes, with a reminder at 1 minute left', () => {
    expect(TOURNAMENT.noShowMs).toBe(180_000);
    expect(TOURNAMENT.readyReminderMs).toBe(60_000);
  });
});

describe('start time and check-in', () => {
  const now = Date.UTC(2026, 9, 1, 20, 0);
  const ok = { name: 'Copa', mode: '1v1' as const, size: 8 as const, buyIn: 0, target: 100, turnSeconds: 25 };

  it('the start is 5 minutes to 7 days ahead', () => {
    expect(validateTournament({ ...ok, startsAt: now + 30 * 60_000 }, now)?.startsAt).toBe(now + 30 * 60_000);
    expect(validateTournament({ ...ok, startsAt: now + 5 * 60_000 }, now)).not.toBeNull();
    expect(validateTournament({ ...ok, startsAt: now + 60_000 }, now)).toBeNull();
    expect(validateTournament({ ...ok, startsAt: now + 8 * 24 * 3_600_000 }, now)).toBeNull();
    expect(validateTournament({ ...ok, startsAt: Number.NaN }, now)).toBeNull();
    // An older app sends no start time: the host starts it by hand.
    expect(validateTournament(ok, now)?.startsAt).toBeUndefined();
  });

  it('check-in opens 15 minutes before', () => {
    const start = now + 60 * 60_000;
    expect(checkInOpen(start, start - 16 * 60_000)).toBe(false);
    expect(checkInOpen(start, start - 15 * 60_000)).toBe(true);
    expect(checkInOpen(start, start + 1)).toBe(true);
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

  it('a champion without a final to play takes it all; a final nobody showed up to is shared', () => {
    expect(prizes(1000, ['c'], [])).toEqual([{ userId: 'c', amount: 1000 }]);
    expect(prizes(1001, [], ['a', 'b1', 'b2'])).toEqual([{ userId: 'a', amount: 335 }, { userId: 'b1', amount: 333 }, { userId: 'b2', amount: 333 }]);
    expect(prizes(1000, [], [])).toEqual([]);
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

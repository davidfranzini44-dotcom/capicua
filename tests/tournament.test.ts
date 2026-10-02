import { describe, expect, it } from 'vitest';
import {
  afterFeeders, bracketSize, checkInOpen, drawFirstRound, firstRound, keptPairs, minEntries, nextMatch, noShowOutcome, pairPartners, placementFor, prizes, roundCount, seedOrder, stage, TOURNAMENT, validateTournament, validateTournamentEdit,
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

  it('private unless the host makes it public', () => {
    expect(validateTournament(ok)?.visibility).toBeUndefined();
    expect(validateTournament({ ...ok, visibility: 'public' })?.visibility).toBe('public');
    expect(validateTournament({ ...ok, visibility: 'secret' as 'public' })).toBeNull();
  });

  it('lets 2v2 hosts choose random or XP-balanced partners', () => {
    expect(validateTournament({ ...ok, partnerMatching: 'random' })?.partnerMatching).toBe('random');
    expect(validateTournament({ ...ok, partnerMatching: 'balanced' })?.partnerMatching).toBe('balanced');
    expect(validateTournament({ ...ok, partnerMatching: 'captains' as never })).toBeNull();
  });

  it('official ones are always public and may carry a house prize, a description and a home spot', () => {
    expect(validateTournament({ ...ok, official: true, visibility: 'private', prize: 10_000, description: '  Sábado   de dominó ', featured: true }))
      .toMatchObject({ official: true, visibility: 'public', prize: 10_000, description: 'Sábado de dominó', featured: true });
    expect(validateTournament({ ...ok, official: true, description: '   ' })?.description).toBeUndefined();
    expect(validateTournament({ ...ok, official: true, prize: -1 })).toBeNull();
    expect(validateTournament({ ...ok, official: true, prize: 2.5 })).toBeNull();
    expect(validateTournament({ ...ok, official: true, prize: TOURNAMENT.maxPrize + 1 })).toBeNull();
    expect(validateTournament({ ...ok, official: true, description: 'x'.repeat(201) })).toBeNull();
  });

  it('only the house adds prizes, descriptions and home-screen spots', () => {
    expect(validateTournament({ ...ok, prize: 500 })).toBeNull();
    expect(validateTournament({ ...ok, description: 'hola' })).toBeNull();
    expect(validateTournament({ ...ok, featured: true })).toBeNull();
    expect(validateTournament({ ...ok, prize: 0, description: '' })).not.toBeNull();
  });

  it('tournament codes are 5 letters (tables are 4), and the whole table can talk', () => {
    expect(roomCode(Math.random, 5)).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(voiceRoomFor('tournament', '2v2', 'ABCD', 1)).toBe('capicua-ABCD');
  });
});

describe('forming 2v2 partners', () => {
  const e = (id: string, xp: number) => ({ id, xp });

  it('balances teams by pairing the highest XP player with the lowest', () => {
    const players = [e('a', 1000), e('b', 800), e('c', 300), e('d', 100)];
    const result = pairPartners(players, 'balanced');
    expect(result.pairs.map(([a, b]) => [a.id, b.id])).toEqual([['a', 'd'], ['b', 'c']]);
    expect(result.leftover).toBeNull();
  });

  it('random pairing still uses every entrant exactly once', () => {
    const players = [e('a', 1000), e('b', 800), e('c', 300), e('d', 100), e('e', 50)];
    const result = pairPartners(players, 'random', undefined, seeded(9));
    expect([...result.pairs.flat(), result.leftover!].map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not leave the host outside when the solo count is odd', () => {
    const players = [e('a', 1000), e('host', 700), e('b', 500), e('c', 300), e('d', 100)];
    const result = pairPartners(players, 'balanced', 'host');
    expect(result.leftover?.id).not.toBe('host');
    expect(result.pairs.flat().some((x) => x.id === 'host')).toBe(true);
  });
});

describe('how the first round is matched', () => {
  const e = (id: string, xp: number) => ({ id, xp });
  const eight = [e('a', 800), e('b', 700), e('c', 600), e('d', 500), e('e', 400), e('f', 300), e('g', 200), e('h', 100)];
  const ids = (ms: [{ id: string }, { id: string } | null][]) => ms.map(([x, y]) => [x.id, y?.id ?? null]);

  it('seed order keeps the top two apart until the final', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('by XP: the most XP plays the least, and the top two sit in opposite halves', () => {
    const ms = ids(drawFirstRound(eight, 'xp'));
    expect(ms).toEqual([['a', 'h'], ['d', 'e'], ['b', 'g'], ['c', 'f']]);
  });

  it('does not create invalid preview slots before a 2v2 lobby has complete teams', () => {
    expect(drawFirstRound([], 'xp')).toEqual([]);
    expect(drawFirstRound([e('a', 800)], 'xp')).toEqual([[e('a', 800), null]]);
  });

  it('by XP with byes: the strongest get them, then best-left against weakest-left', () => {
    const six = eight.slice(0, 6); // bracket of 8 → 2 byes
    const ms = ids(drawFirstRound(six, 'xp'));
    expect(ms).toHaveLength(4);
    expect(ms.filter(([, b]) => b === null).map(([a]) => a).sort()).toEqual(['a', 'b']);
    expect(ms).toContainEqual(['c', 'f']);
    expect(ms).toContainEqual(['d', 'e']);
    // a (1st) and b (2nd) in opposite halves
    const slot = (id: string) => ms.findIndex(([x]) => x === id);
    expect(Math.floor(slot('a') / 2)).not.toBe(Math.floor(slot('b') / 2));
  });

  it('fixed matches are kept as they are; everyone else is drawn, and each entry plays once', () => {
    for (const seeding of ['random', 'pick', 'xp'] as const) {
      const ms = ids(drawFirstRound(eight, seeding, [['a', 'b'], ['c', 'h']], seeded(3)));
      expect(ms).toContainEqual(['a', 'b']);
      expect(ms).toContainEqual(['c', 'h']);
      expect(ms.flat().filter(Boolean).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    }
  });

  it('only as many fixed matches as still leave a real opponent or a bye for everyone', () => {
    // 5 entries → bracket of 8, 3 byes → at most one real match.
    expect(keptPairs(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['c', 'd']])).toEqual([['a', 'b']]);
    // Gone, repeated or self-pairs are skipped.
    expect(keptPairs(['a', 'b', 'c', 'd'], [['a', 'z'], ['a', 'a'], ['b', 'c'], ['c', 'd'], ['a', 'd']])).toEqual([['b', 'c'], ['a', 'd']]);
    const ms = drawFirstRound(eight.slice(0, 5), 'pick', [['a', 'b'], ['c', 'd']], seeded(1));
    expect(ms).toHaveLength(4);
    expect(ms.filter(([, b]) => b === null)).toHaveLength(3);
  });
});

describe('editing before the start', () => {
  const now = Date.now();
  it('the host changes name, start time (or clears it), target, timer and matching', () => {
    expect(validateTournamentEdit({ name: '  Copa   nueva ', target: 150, turnSeconds: 40, seeding: 'xp', partnerMatching: 'balanced' }, false, now))
      .toEqual({ name: 'Copa nueva', target: 150, turnSeconds: 40, seeding: 'xp', partnerMatching: 'balanced' });
    expect(validateTournamentEdit({ startsAt: now + 60 * 60_000 }, false, now)).toEqual({ startsAt: now + 60 * 60_000 });
    expect(validateTournamentEdit({ startsAt: null }, false, now)).toEqual({ startsAt: null });
  });
  it('refuses what is out of range, and the size for anyone but an admin', () => {
    expect(validateTournamentEdit({ startsAt: now + 60_000 }, false, now)).toBeNull();
    expect(validateTournamentEdit({ target: 123 }, false, now)).toBeNull();
    expect(validateTournamentEdit({ seeding: 'vip' as never }, false, now)).toBeNull();
    expect(validateTournamentEdit({ partnerMatching: 'captains' as never }, false, now)).toBeNull();
    expect(validateTournamentEdit({ size: 16 }, false, now)).toBeNull();
    expect(validateTournamentEdit({ size: 16 }, true, now)).toEqual({ size: 16 });
    expect(validateTournamentEdit({}, true, now)).toBeNull();
  });
  it('the host may make it public or private; only an admin changes the house prize and the description', () => {
    expect(validateTournamentEdit({ visibility: 'public' }, false, now)).toEqual({ visibility: 'public' });
    expect(validateTournamentEdit({ visibility: 'open' as 'public' }, false, now)).toBeNull();
    expect(validateTournamentEdit({ prize: 5000 }, false, now)).toBeNull();
    expect(validateTournamentEdit({ description: 'hola' }, false, now)).toBeNull();
    expect(validateTournamentEdit({ prize: 5000, description: ' Gran  final ' }, true, now)).toEqual({ prize: 5000, description: 'Gran final' });
    expect(validateTournamentEdit({ description: '' }, true, now)).toEqual({ description: '' });
    expect(validateTournamentEdit({ prize: -5 }, true, now)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { CLASSIC_DR, newGame, type Mode, type Seat } from '../supabase/functions/_shared/domino.ts';
import {
  autoAction, botsAllowed, chestReward, CHESTS, effectiveStake, packFor, rollChest, rushCost, salaFor, gameXp, levelFromXp, levelTitle, minHumans, needsReadyCheck, payouts, publicState, roomCode,
  sideBetMultiplier, sideBetWon, TIMING, validateCustom, voiceRoomFor, xpForLevel, type SeatInfo,
} from '../supabase/functions/_shared/table.ts';

const human = (seat: Seat, id: string): SeatInfo => ({ seat, userId: id, name: id, isBot: false, away: false });
const bot = (seat: Seat): SeatInfo => ({ seat, userId: null, name: 'bot', isBot: true, away: false });
const TURN = 15_000;

describe('visibility & timing', () => {
  it('never exposes hands or the pile in the public state', () => {
    const g = newGame(Math.random, { ...CLASSIC_DR, mode: '1v1' });
    const p = publicState(g);
    expect('hands' in p || 'boneyard' in p).toBe(false);
    expect(p.handCounts).toEqual([7, 7]);
    expect(p.boneyardCount).toBe(14);
  });

  it('bots move after the bot delay; humans get a strike after the turn timer', () => {
    const g = newGame();
    const seatsBot = ([0, 1, 2, 3] as Seat[]).map((s) => (s === g.turn ? bot(s) : human(s, `u${s}`)));
    expect(autoAction(g, seatsBot, TURN, 0, TIMING.botMs - 1)).toBeNull();
    expect(autoAction(g, seatsBot, TURN, 0, TIMING.botMs)).toMatchObject({ kind: 'move', strike: false, move: { tile: [6, 6] } });

    const humans = ([0, 1, 2, 3] as Seat[]).map((s) => human(s, `u${s}`));
    expect(autoAction(g, humans, TURN, 0, 10_000)).toBeNull();
    expect(autoAction(g, humans, TURN, 0, TURN)).toMatchObject({ kind: 'move', strike: true });

    const away = humans.map((x) => (x.seat === g.turn ? { ...x, away: true } : x));
    expect(autoAction(g, away, TURN, 0, TIMING.awayMs)).toMatchObject({ kind: 'move', strike: false });
  });
});

describe('chips', () => {
  it('only bets when two sides have a person', () => {
    expect(effectiveStake('2v2', 500, [human(0, 'a'), bot(1), human(2, 'b'), bot(3)])).toBe(0);
    expect(effectiveStake('2v2', 500, [human(0, 'a'), human(1, 'b'), bot(2), bot(3)])).toBe(500);
    expect(effectiveStake('1v1', 500, [human(0, 'a'), bot(1)])).toBe(0);
    expect(effectiveStake('ffa', 500, [human(0, 'a'), bot(1), bot(2), human(3, 'd')])).toBe(500);
  });

  it('2v2 / 1v1: winners split the pot', () => {
    const four = [human(0, 'a'), human(1, 'b'), human(2, 'c'), human(3, 'd')];
    expect(payouts('2v2', 500, four, { winner: 0, scores: [100, 40] })).toEqual([{ userId: 'a', amount: 1000 }, { userId: 'c', amount: 1000 }]);
    expect(payouts('1v1', 1000, [human(0, 'a'), human(1, 'b')], { winner: 1, scores: [20, 105] })).toEqual([{ userId: 'b', amount: 2000 }]);
  });

  it('ffa: best human 70%, next 30%; ties split; bots don\'t place', () => {
    const four = [human(0, 'a'), human(1, 'b'), human(2, 'c'), human(3, 'd')];
    expect(payouts('ffa', 500, four, { winner: 2, scores: [30, 60, 110, 5] }))
      .toEqual([{ userId: 'c', amount: 1400 }, { userId: 'b', amount: 600 }]);
    // Tie for second: 30% split.
    expect(payouts('ffa', 500, four, { winner: 2, scores: [60, 60, 110, 5] }))
      .toEqual([{ userId: 'c', amount: 1400 }, { userId: 'a', amount: 300 }, { userId: 'b', amount: 300 }]);
    // A bot wins: the two humans are 1st and 2nd among people.
    const mixed = [human(0, 'a'), bot(1), bot(2), human(3, 'd')];
    expect(payouts('ffa', 500, mixed, { winner: 1, scores: [20, 101, 50, 40] }))
      .toEqual([{ userId: 'd', amount: 700 }, { userId: 'a', amount: 300 }]);
  });
});

describe('side bets', () => {
  it('multipliers come from the odds table with the house edge', () => {
    const m = sideBetMultiplier({ mode: '2v2', target: 100 }, 'cap1')!;
    expect(m).toBeGreaterThan(3);
    expect(m).toBeLessThan(1 / 0.2395); // below fair
    for (const mode of ['1v1', '2v2', 'ffa'] as Mode[]) {
      for (const target of [100, 150, 200]) {
        for (const k of ['cap1', 'cap2', 'pollona'] as const) {
          const x = sideBetMultiplier({ mode, target }, k)!;
          expect(x).toBeGreaterThan(1);
          expect(x).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it('settles against the whole-game tally', () => {
    const state = { winner: 0, scores: [110, 0], tally: { capicuas: [2, 1], tranques: [0, 0], hands: [5, 1] } };
    expect(sideBetWon('cap1', state, 0)).toBe(true);
    expect(sideBetWon('cap2', state, 0)).toBe(true);
    expect(sideBetWon('cap2', state, 1)).toBe(false);
    expect(sideBetWon('pollona', state, 0)).toBe(true);
    expect(sideBetWon('pollona', { ...state, scores: [110, 5] }, 0)).toBe(false);
  });
});

describe('levels & matchmaking', () => {
  it('level curve and titles', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(xpForLevel(10))).toBe(10);
    expect(levelTitle(1).es).toBe('Novato');
    expect(levelTitle(7).es).toBe('Tíguere');
    expect(levelTitle(40).es).toBe('Leyenda');
    expect(gameXp({ won: true, capicuas: 1, pollona: false })).toBe(55);
  });

  it('bet tables: 1v1/2v2 people only, ffa needs 2 people, free tables can use bots', () => {
    expect(minHumans('2v2', 500)).toBe(4);
    expect(minHumans('1v1', 500)).toBe(2);
    expect(minHumans('ffa', 500)).toBe(2);
    expect(botsAllowed('2v2', 500)).toBe(false);
    expect(botsAllowed('1v1', 1)).toBe(false);
    expect(botsAllowed('ffa', 500)).toBe(true);
    expect(minHumans('2v2', 0)).toBe(1);
    expect(botsAllowed('2v2', 0)).toBe(true);
  });

  it('friendly matchmaking is stake 0, open to any balance', () => {
    expect(salaFor(0)).toEqual({ stake: 0, minBalance: 0 });
    expect(salaFor(500)).toMatchObject({ stake: 500, minBalance: 2500 });
    expect(salaFor(750)).toBeNull();
  });

  it('chests: odds add up, rewards stay in range, rushing costs chips', () => {
    const total = Object.values(CHESTS).reduce((a, c) => a + c.chance, 0);
    expect(total).toBeCloseTo(1);
    expect(rollChest(() => 0)).toBe('wood');
    expect(rollChest(() => 0.61)).toBe('silver');
    expect(rollChest(() => 0.9)).toBe('gold');
    expect(rollChest(() => 0.995)).toBe('diamond');
    for (const k of ['wood', 'silver', 'gold', 'diamond'] as const) {
      for (const r of [0, 0.5, 0.999]) {
        const { chips, xp } = chestReward(k, () => r);
        expect(chips).toBeGreaterThanOrEqual(CHESTS[k].chips[0]);
        expect(chips).toBeLessThanOrEqual(CHESTS[k].chips[1]);
        expect(xp).toBe(CHESTS[k].xp);
      }
    }
    expect(rushCost(60_000)).toBe(25);
    expect(rushCost(30 * 60_000)).toBe(150);
    expect(rushCost(3 * 3600_000)).toBe(900);
  });

  it('chip packs', () => {
    expect(packFor('p15k')).toMatchObject({ chips: 15000, cents: 499 });
    expect(packFor('free-money')).toBeNull();
  });

  it('ready check only when levels are far apart', () => {
    expect(needsReadyCheck([3, 5, 8, 4])).toBe(false);
    expect(needsReadyCheck([3, 12])).toBe(true);
  });

  it('custom settings are validated', () => {
    expect(validateCustom({ mode: '2v2', stake: 750, target: 150, turnSeconds: 25, visibility: 'private' }))
      .toMatchObject({ capicuaBonus: true, paseCorridoBonus: true });
    expect(validateCustom({ mode: '2v2', stake: -1, target: 150, turnSeconds: 25, visibility: 'private' })).toBeNull();
    expect(validateCustom({ mode: '3v3' as Mode, stake: 0, target: 100, turnSeconds: 25, visibility: 'public' })).toBeNull();
    expect(validateCustom({ mode: '1v1', stake: 0, target: 120, turnSeconds: 25, visibility: 'public' })).toBeNull();
  });

  it('voice: full table in custom, team-only in public 2v2, none in public 1v1/ffa', () => {
    expect(voiceRoomFor('custom', 'ffa', 'ABCD', 3)).toBe('capicua-ABCD');
    expect(voiceRoomFor('public', '2v2', 'ABCD', 3)).toBe('capicua-ABCD-team1');
    expect(voiceRoomFor('public', '2v2', 'ABCD', 1)).toBe('capicua-ABCD-team1');
    expect(voiceRoomFor('public', '1v1', 'ABCD', 0)).toBeNull();
  });

  it('room codes are 4 easy-to-read letters', () => {
    for (let i = 0; i < 50; i++) expect(roomCode()).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});

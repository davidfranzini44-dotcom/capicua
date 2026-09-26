import { describe, expect, it } from 'vitest';
import { applyMove, forcedMove, newGame, type Seat } from '../supabase/functions/_shared/domino.ts';
import { chooseMove } from '../supabase/functions/_shared/bot.ts';
import { publicRules } from '../supabase/functions/_shared/table.ts';
import { layoutBoard } from '../src/ui/boardLayout';
import { OWNER_ARROW, ownerRole } from '../src/ui/owners';

describe('ownerRole: who played a tile, from my chair', () => {
  it('1v1: me and the player across', () => {
    expect([0, 1].map((s) => ownerRole('1v1', 0, s as Seat))).toEqual(['me', 'top']);
    expect([0, 1].map((s) => ownerRole('1v1', 1, s as Seat))).toEqual(['top', 'me']);
  });

  it('2v2: partner across, opponents left and right (same spots as the seat badges)', () => {
    // TableView draws rel(1) on the right, rel(2) on top, rel(3) on the left.
    expect([0, 1, 2, 3].map((s) => ownerRole('2v2', 0, s as Seat))).toEqual(['me', 'right', 'partner', 'left']);
    expect([0, 1, 2, 3].map((s) => ownerRole('2v2', 3, s as Seat))).toEqual(['right', 'partner', 'left', 'me']);
  });

  it('free-for-all: the chair across is an opponent, not a partner', () => {
    expect([0, 1, 2, 3].map((s) => ownerRole('ffa', 2, s as Seat))).toEqual(['top', 'left', 'me', 'right']);
  });

  it('every spot at a table gets a different marker', () => {
    for (const mode of ['1v1', '2v2', 'ffa'] as const) {
      const seats = mode === '1v1' ? [0, 1] : [0, 1, 2, 3];
      for (const me of seats) {
        const roles = seats.map((s) => ownerRole(mode, me as Seat, s as Seat));
        expect(new Set(roles).size).toBe(seats.length);
        expect(new Set(roles.map((r) => OWNER_ARROW[r])).size).toBe(seats.length); // shapes differ too, not just colors
      }
    }
  });
});

describe('layoutBoard keeps who played each tile', () => {
  it('every laid tile carries the seat of the move that placed it', () => {
    for (const mode of ['1v1', '2v2', 'ffa'] as const) {
      let s = newGame(() => 0.42, publicRules(mode));
      while (!s.handResult) s = applyMove(s, forcedMove(s, s.turn) ?? chooseMove(s, s.turn, () => 0.5));
      const played = new Map<string, Seat>(s.events.flatMap((e) => (e.kind === 'play' ? [[`${e.tile[0]}-${e.tile[1]}`, e.seat] as [string, Seat]] : [])));
      const laid = layoutBoard(s.line, s.origin).tiles;
      expect(laid).toHaveLength(s.line.length);
      for (const t of laid) expect(t.seat).toBe(played.get(t.key));
    }
  });
});

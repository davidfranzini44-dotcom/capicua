import { describe, expect, it } from 'vitest';
import type { GameEvent, Seat } from '../supabase/functions/_shared/domino.ts';
import { placementRun } from '../src/lib/tableMotion.ts';

const play = (seat: Seat): GameEvent => ({ kind: 'play', seat, tile: [1, 2], side: 'R' });

describe('table placement streak', () => {
  it('counts consecutive team placements in a hand, ignoring passes', () => {
    const events: GameEvent[] = [play(0), { kind: 'pass', seat: 1 }, play(2), play(0)];
    expect(placementRun(events, '2v2')).toEqual({ side: 0, count: 3, seat: 0 });
    expect(placementRun([...events, play(1)], '2v2')).toBeNull();
  });

  it('does not call ordinary turns or solo games a team streak', () => {
    expect(placementRun([play(0)], '2v2')).toBeNull();
    expect(placementRun([play(0), play(0)], '1v1')).toBeNull();
  });
});

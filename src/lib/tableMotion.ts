import { sideOf, type GameEvent, type Mode, type Seat } from '../../supabase/functions/_shared/domino.ts';

/** Consecutive fichas placed by one team in this hand; passes/draws don't count. */
export function placementRun(events: readonly GameEvent[], mode: Mode): { side: number; count: number; seat: Seat } | null {
  if (mode !== '2v2') return null;
  let side = -1;
  let count = 0;
  let seat: Seat = 0;
  for (const event of events) {
    if (event.kind !== 'play') continue;
    const playedSide = sideOf(mode, event.seat);
    count = playedSide === side ? count + 1 : 1;
    side = playedSide;
    seat = event.seat;
  }
  return count >= 2 ? { side, count, seat } : null;
}

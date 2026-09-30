// Where someone finished in a knockout tournament, for their history and the podium.
// Placements come from the server (placementFor): 1 the champion, 2 the other finalist(s),
// 3 the semifinal losers, 5 the quarterfinal ones and so on.
import { stage } from '../../supabase/functions/_shared/tournament.ts';

export type Finish =
  | { kind: 'champion' }
  | { kind: 'runnerUp' }
  | { kind: 'semi' }
  | { kind: 'out'; stage: ReturnType<typeof stage> | null };

export function finishOf(placement: number | null, eliminatedRound: number | null, rounds: number | null): Finish {
  if (placement === 1) return { kind: 'champion' };
  if (placement === 2) return { kind: 'runnerUp' };
  if (placement === 3) return { kind: 'semi' };
  return { kind: 'out', stage: eliminatedRound && rounds ? stage(eliminatedRound, rounds) : null };
}

/** The cup (or not) that goes with a finish. */
export const metalOf = (f: Finish): 'gold' | 'silver' | 'bronze' | null =>
  f.kind === 'champion' ? 'gold' : f.kind === 'runnerUp' ? 'silver' : f.kind === 'semi' ? 'bronze' : null;

const SEEN_KEY = 'capicua.trophySeen';
/** The champion's celebration shows once per tournament on this device. */
export function trophySeen(tournamentId: string): boolean {
  try { return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(tournamentId); } catch { return false; }
}
export function markTrophySeen(tournamentId: string) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen.filter((x) => x !== tournamentId), tournamentId].slice(-50)));
  } catch { /* storage unavailable: it may show again */ }
}

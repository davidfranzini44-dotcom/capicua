// Who played each domino, as seen from my chair: me at the bottom, the rest
// where they sit on my screen. Each spot has its own color *and* its own
// arrow shape (pointing at that player), so the markers never rely on color.
import { playerCount, type Mode, type Seat } from '../../supabase/functions/_shared/domino.ts';

/** Screen spot of a seat: `partner` is the top chair in 2v2, `top` in 1v1 and free-for-all. */
export type OwnerRole = 'me' | 'partner' | 'top' | 'left' | 'right';

/** Where `seat` sits on my screen. Matches TableView: rel 1 = right, 2 = top, 3 = left (top in 1v1). */
export function ownerRole(mode: Mode, mySeat: Seat, seat: Seat): OwnerRole {
  const n = playerCount(mode);
  const rel = (seat - mySeat + n) % n;
  if (rel === 0) return 'me';
  if (n === 2) return 'top';
  if (rel === 2) return mode === '2v2' ? 'partner' : 'top';
  return rel === 1 ? 'right' : 'left';
}

/** Arrow direction for each spot: it points at the player (me = down, towards the bottom of the screen). */
export const OWNER_ARROW: Record<OwnerRole, 'down' | 'up' | 'left' | 'right'> = {
  me: 'down', partner: 'up', top: 'up', left: 'left', right: 'right',
};

/** A small triangle centred on (cx, cy), pointing `dir`; r = distance from centre to the tip. */
export function arrowPath(cx: number, cy: number, r: number, dir: 'down' | 'up' | 'left' | 'right'): string {
  const w = r * 0.95; // half the base
  const pts: [number, number][] =
    dir === 'down' ? [[cx - w, cy - r * 0.6], [cx + w, cy - r * 0.6], [cx, cy + r]]
    : dir === 'up' ? [[cx - w, cy + r * 0.6], [cx + w, cy + r * 0.6], [cx, cy - r]]
    : dir === 'left' ? [[cx + r * 0.6, cy - w], [cx + r * 0.6, cy + w], [cx - r, cy]]
    : [[cx - r * 0.6, cy - w], [cx - r * 0.6, cy + w], [cx + r, cy]];
  return `M${pts.map(([x, y]) => `${+x.toFixed(3)} ${+y.toFixed(3)}`).join(' L')} Z`;
}

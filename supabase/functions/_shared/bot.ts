import {
  ends, forcedMove, isDouble, legalMoves, nextSeat, pips, sameTile, seatsOf, sideOf,
  type GameState, type Move, type Seat, type Tile,
} from './domino.ts';

/**
 * Heuristic bot. Uses only what a real player at the table knows:
 * its own hand, the tiles played, and who has passed on which numbers.
 */
export function chooseMove(state: GameState, seat: Seat, rng: () => number = Math.random): Move {
  const moves = legalMoves(state, seat);
  if (moves.length === 0) return forcedMove(state, seat)!;
  if (moves.length === 1) return moves[0];

  const mode = state.rules.mode;
  const hand = state.hands[seat];
  const e = ends(state);
  const next = nextSeat(state, seat);
  const others = seatsOf(mode).filter((p) => p !== seat);
  const partners = others.filter((p) => sideOf(mode, p) === sideOf(mode, seat));
  const rivals = others.filter((p) => sideOf(mode, p) !== sideOf(mode, seat));

  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    if (m.type !== 'play') continue;
    const rest = hand.filter((t) => !sameTile(t, m.tile));
    const newEnds = resultingEnds(e, m.tile, m.side);
    const shuts = (p: Seat) => newEnds.every((n) => state.voids[p].includes(n));
    let score = pips(m.tile); // shed heavy tiles
    if (isDouble(m.tile)) score += 6; // doubles are hard to place later
    // Keep ends we can follow up on.
    for (const n of newEnds) score += 2.5 * rest.filter((t) => t[0] === n || t[1] === n).length;
    // Close off the next rival, keep partners alive.
    if (rivals.includes(next)) {
      if (shuts(next)) score += 12;
      else if (newEnds.some((n) => state.voids[next].includes(n))) score += 4;
    }
    for (const r of rivals) if (r !== next && shuts(r)) score += 4;
    for (const p of partners) if (shuts(p)) score -= 8;
    // Winning tile — always take it.
    if (rest.length === 0) score += 1000;
    score += rng() * 1.5; // a little personality
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}

function resultingEnds(e: [number, number] | null, tile: Tile, side: 'L' | 'R'): number[] {
  if (!e) return [tile[0], tile[1]];
  const [l, r] = e;
  if (side === 'L') return [tile[0] === l ? tile[1] : tile[0], r];
  return [l, tile[0] === r ? tile[1] : tile[0]];
}

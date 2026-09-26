import {
  comodinOptions, dobleSequences, ends, forcedMove, isDouble, legalMoves, nextSeat, pips, placeOnLine, powerBlock, sameTile, seatsOf, sideOf,
  type GameState, type Move, type Seat, type Side, type Tile,
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

/**
 * Arcade bot: the same ordinary play, plus powers when they pay off — again
 * using only its own hand, the board, charges and who passed on what.
 *  - Stuck (nothing to play): a Comodín that lays its heaviest ficha, else a
 *    Cambio with the rival holding the most fichas, else pass.
 *  - Candado when the next player is a rival who has shown they lack the end
 *    that would be left open (they'll likely have to pass).
 *  - Doble golpe now and then to shed two heavy fichas at once.
 * Never spends a power when it's down to its last ficha or two anyway.
 */
export function chooseArcadeMove(state: GameState, seat: Seat, rng: () => number = Math.random): Move {
  const a = state.arcade;
  const ordinary = legalMoves(state, seat);
  const hand = state.hands[seat];
  if (!a) return ordinary.length ? chooseMove(state, seat, rng) : forcedMove(state, seat)!;

  const mode = state.rules.mode;
  const rivals = seatsOf(mode).filter((p) => sideOf(mode, p) !== sideOf(mode, seat));

  if (ordinary.length === 0) {
    if (powerBlock(state, seat, 'comodin') === null) {
      const options = comodinOptions(state, seat);
      const best = options.reduce((x, y) => (pips(y.tile) > pips(x.tile) ? y : x));
      return { type: 'comodin', tile: best.tile, side: best.side, half: best.half };
    }
    if (powerBlock(state, seat, 'cambio') === null) {
      const target = rivals.reduce((x, y) => (state.hands[y].length > state.hands[x].length ? y : x));
      const give = hand.reduce((x, y) => (pips(y) > pips(x) ? y : x));
      return { type: 'cambio', tile: give, target };
    }
    return forcedMove(state, seat)!;
  }

  const play = chooseMove(state, seat, rng) as Extract<Move, { type: 'play' }>;
  if (hand.length <= 2) return play;

  // Candado: leave the next rival only the end they've shown they can't follow.
  const next = nextSeat(state, seat);
  if (powerBlock(state, seat, 'candado') === null && rivals.includes(next)) {
    const after = ends({ line: placeOnLine(state.line, state.origin, seat, play.tile, play.side).line })!;
    for (const lock of ['L', 'R'] as Side[]) {
      const open = lock === 'L' ? after[1] : after[0];
      if (state.voids[next].includes(open) && rng() < 0.8) return { ...play, lock };
    }
  }

  // Doble golpe: two heavy fichas out at once, sometimes.
  if (powerBlock(state, seat, 'doble') === null && hand.length >= 4 && rng() < 0.3) {
    const seqs = dobleSequences(state, seat);
    const best = seqs.reduce((x, y) => (pips(y.first.tile) + pips(y.second.tile) > pips(x.first.tile) + pips(x.second.tile) ? y : x));
    return { type: 'doble', first: best.first, second: best.second };
  }

  // Comodín, once in a while, to get rid of a heavy ficha that doesn't fit.
  if (powerBlock(state, seat, 'comodin') === null && rng() < 0.12) {
    const heavy = comodinOptions(state, seat).filter((o) => pips(o.tile) > pips(play.tile) + 3);
    if (heavy.length) {
      const o = heavy.reduce((x, y) => (pips(y.tile) > pips(x.tile) ? y : x));
      return { type: 'comodin', tile: o.tile, side: o.side, half: o.half };
    }
  }
  return play;
}

function resultingEnds(e: [number, number] | null, tile: Tile, side: 'L' | 'R'): number[] {
  if (!e) return [tile[0], tile[1]];
  const [l, r] = e;
  if (side === 'L') return [tile[0] === l ? tile[1] : tile[0], r];
  return [l, tile[0] === r ? tile[1] : tile[0]];
}

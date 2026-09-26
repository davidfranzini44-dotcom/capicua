// Choosing an Arcade power step by step, before anything is sent: which ficha,
// which end, which rival / half / lock, a preview on the board, then confirm.
// Pure: works on the player's own view of the game (their hand + the public
// state). Cancelling at any step costs nothing.

import {
  comodinOptions, dobleSequences, legalMoves, normalize, placeOnLine, sameTile, seatsOf, sideOf,
  type GameState, type Move, type Placed, type Power, type Seat, type Side, type Tile,
} from '../../supabase/functions/_shared/domino.ts';

export interface Placement { tile: Tile; side: Side }

export type Draft =
  | { power: 'cambio'; tile?: Tile; target?: Seat }
  | { power: 'doble'; first?: Placement; second?: Placement; picking?: Tile }
  | { power: 'comodin'; tile?: Tile; side?: Side; half?: 0 | 1 }
  | { power: 'candado'; play?: Placement; picking?: Tile; lock?: Side };

export type DraftStep = 'tile' | 'side' | 'target' | 'half' | 'lock' | 'confirm';

export interface DraftView {
  step: DraftStep;
  /** Which placement a Doble golpe is on (1 or 2). */
  part?: 1 | 2;
  /** Fichas in the hand that can be tapped now. */
  tiles: Tile[];
  /** The ficha currently picked (raised in the hand). */
  selected: Tile | null;
  /** Board ends that can be tapped now. */
  sides: Side[];
  /** The board as it would look (with the preview tiles). */
  line: Placed[];
  origin: number;
  /** Preview tiles on that board (by physical key). */
  ghosts: string[];
  /** Cambio: the rivals to swap with. */
  targets: Seat[];
  /** Comodín: how the ficha can connect (which half changes, and what it becomes). */
  halves: { half: 0 | 1; becomes: Tile }[];
  /** Candado: each end of the new board, with its number. */
  locks: { side: Side; value: number }[];
  /** Complete: the move to send on Confirm. */
  move: Move | null;
}

const keyOf = (t: Tile) => { const [a, b] = normalize(t[0], t[1]); return `${a}-${b}`; };
const uniq = (tiles: Tile[]) => tiles.filter((t, i) => tiles.findIndex((u) => sameTile(u, t)) === i);
const uniqSides = (sides: Side[]) => (['L', 'R'] as Side[]).filter((s) => sides.includes(s));

export function startDraft(power: Power): Draft {
  return { power } as Draft;
}

/** The player's own game: their hand plus what everyone can see. */
export function draftView(s: GameState, seat: Seat, d: Draft): DraftView {
  const base: DraftView = {
    step: 'tile', tiles: [], selected: null, sides: [], line: s.line, origin: s.origin, ghosts: [],
    targets: [], halves: [], locks: [], move: null,
  };
  const withTile = (line: Placed[], origin: number, p: Placement, wild?: 0 | 1) => placeOnLine(line, origin, seat, p.tile, p.side, wild);

  if (d.power === 'cambio') {
    if (!d.tile) return { ...base, tiles: s.hands[seat] };
    const mode = s.rules.mode;
    const targets = seatsOf(mode).filter((p) => sideOf(mode, p) !== sideOf(mode, seat) && s.hands[p].length > 0);
    if (d.target === undefined) return { ...base, step: 'target', selected: d.tile, tiles: s.hands[seat], targets };
    return { ...base, step: 'confirm', selected: d.tile, targets, move: { type: 'cambio', tile: d.tile, target: d.target } };
  }

  if (d.power === 'doble') {
    const seqs = dobleSequences(s, seat);
    if (!d.first) {
      if (d.picking) {
        const sides = uniqSides(seqs.filter((q) => sameTile(q.first.tile, d.picking!)).map((q) => q.first.side));
        return { ...base, step: 'side', part: 1, selected: d.picking, tiles: uniq(seqs.map((q) => q.first.tile)), sides };
      }
      return { ...base, part: 1, tiles: uniq(seqs.map((q) => q.first.tile)) };
    }
    const after = withTile(s.line, s.origin, d.first);
    const rest = seqs.filter((q) => sameTile(q.first.tile, d.first!.tile) && q.first.side === d.first!.side);
    const ghosts = [keyOf(d.first.tile)];
    if (!d.second) {
      const tiles = uniq(rest.map((q) => q.second.tile));
      if (d.picking) {
        const sides = uniqSides(rest.filter((q) => sameTile(q.second.tile, d.picking!)).map((q) => q.second.side));
        return { ...base, step: 'side', part: 2, selected: d.picking, tiles, sides, ...after, ghosts };
      }
      return { ...base, part: 2, tiles, ...after, ghosts };
    }
    const both = withTile(after.line, after.origin, d.second);
    return {
      ...base, step: 'confirm', ...both, ghosts: [...ghosts, keyOf(d.second.tile)],
      move: { type: 'doble', first: d.first, second: d.second },
    };
  }

  if (d.power === 'comodin') {
    const opts = comodinOptions(s, seat);
    if (!d.tile) return { ...base, tiles: uniq(opts.map((o) => o.tile)) };
    const forTile = opts.filter((o) => sameTile(o.tile, d.tile!));
    if (!d.side) return { ...base, step: 'side', selected: d.tile, tiles: uniq(opts.map((o) => o.tile)), sides: uniqSides(forTile.map((o) => o.side)) };
    const halves = forTile.filter((o) => o.side === d.side).map((o) => ({ half: o.half, becomes: o.becomes }));
    if (d.half === undefined) return { ...base, step: 'half', selected: d.tile, tiles: uniq(opts.map((o) => o.tile)), halves };
    const placed = withTile(s.line, s.origin, { tile: d.tile, side: d.side }, d.half);
    return {
      ...base, step: 'confirm', selected: d.tile, halves, ...placed, ghosts: [keyOf(d.tile)],
      move: { type: 'comodin', tile: d.tile, side: d.side, half: d.half },
    };
  }

  // Candado
  const moves = legalMoves(s, seat).filter((m): m is Extract<Move, { type: 'play' }> => m.type === 'play');
  const tiles = uniq(moves.map((m) => m.tile));
  if (!d.play) {
    if (d.picking) return { ...base, step: 'side', selected: d.picking, tiles, sides: uniqSides(moves.filter((m) => sameTile(m.tile, d.picking!)).map((m) => m.side)) };
    return { ...base, tiles };
  }
  const after = withTile(s.line, s.origin, d.play);
  const locks = [
    { side: 'L' as Side, value: after.line[0].a },
    { side: 'R' as Side, value: after.line[after.line.length - 1].b },
  ];
  const ghosts = [keyOf(d.play.tile)];
  if (!d.lock) return { ...base, step: 'lock', ...after, ghosts, locks };
  return { ...base, step: 'confirm', ...after, ghosts, locks, move: { type: 'play', tile: d.play.tile, side: d.play.side, lock: d.lock } };
}

/** A ficha in the hand was tapped. */
export function draftTapTile(s: GameState, seat: Seat, d: Draft, tile: Tile): Draft {
  const v = draftView(s, seat, d);
  if (!v.tiles.some((t) => sameTile(t, tile))) return d;
  const again = v.selected && sameTile(v.selected, tile);
  switch (d.power) {
    case 'cambio':
      return again ? { power: 'cambio' } : { power: 'cambio', tile };
    case 'comodin':
      return again ? { power: 'comodin' } : autoComodin(s, seat, { power: 'comodin', tile });
    case 'doble': {
      if (again) return { ...d, picking: undefined };
      const seqs = dobleSequences(s, seat);
      if (!d.first) {
        const sides = uniqSides(seqs.filter((q) => sameTile(q.first.tile, tile)).map((q) => q.first.side));
        return sides.length === 1 ? { power: 'doble', first: { tile, side: sides[0] } } : { power: 'doble', picking: tile };
      }
      const sides = uniqSides(seqs.filter((q) => sameTile(q.first.tile, d.first!.tile) && q.first.side === d.first!.side && sameTile(q.second.tile, tile)).map((q) => q.second.side));
      return sides.length === 1 ? { ...d, picking: undefined, second: { tile, side: sides[0] } } : { ...d, picking: tile };
    }
    case 'candado': {
      if (again) return { power: 'candado' };
      const sides = uniqSides(legalMoves(s, seat).flatMap((m) => (m.type === 'play' && sameTile(m.tile, tile) ? [m.side] : [])));
      return sides.length === 1 ? { power: 'candado', play: { tile, side: sides[0] } } : { power: 'candado', picking: tile };
    }
  }
}

/** A board end was tapped. */
export function draftPickSide(s: GameState, seat: Seat, d: Draft, side: Side): Draft {
  const v = draftView(s, seat, d);
  if (v.step !== 'side' || !v.sides.includes(side)) return d;
  switch (d.power) {
    case 'doble':
      return d.first ? { ...d, picking: undefined, second: { tile: d.picking!, side } } : { power: 'doble', first: { tile: d.picking!, side } };
    case 'comodin':
      return autoComodin(s, seat, { ...d, side });
    case 'candado':
      return { power: 'candado', play: { tile: d.picking!, side } };
    default:
      return d;
  }
}

/** Comodín skips the questions that have only one answer (one end, one way to connect). */
function autoComodin(s: GameState, seat: Seat, d: Extract<Draft, { power: 'comodin' }>): Draft {
  const opts = comodinOptions(s, seat).filter((o) => sameTile(o.tile, d.tile!));
  let next = d;
  if (!next.side) {
    const sides = uniqSides(opts.map((o) => o.side));
    if (sides.length === 1) next = { ...next, side: sides[0] };
  }
  if (next.side && next.half === undefined) {
    const halves = opts.filter((o) => o.side === next.side);
    if (halves.length === 1) next = { ...next, half: halves[0].half };
  }
  return next;
}

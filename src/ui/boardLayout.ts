import type { Placed, Seat } from '../../supabase/functions/_shared/domino.ts';

/** A tile positioned in board units (1 unit = half a tile). */
export interface LaidTile {
  key: string;
  x: number;
  y: number;
  vertical: boolean;
  /** Value on the left (horizontal) or top (vertical) half. */
  first: number;
  second: number;
  seat: Seat;
}

export interface ArmEnd {
  side: 'L' | 'R';
  x: number;
  y: number;
}

export interface BoardLayout {
  tiles: LaidTile[];
  ends: ArmEnd[];
  viewBox: [number, number, number, number];
}

/** Half-width of a row before the snake turns, unless the board asks for another. */
export const DEFAULT_LIMIT = 5;

/**
 * Row length that makes chains as big as possible in a board of this size:
 * short and wide boards want long rows, tall ones short rows. Scored on a
 * short and a long sample chain; on a tie the longer row wins (fewer turns as
 * the chain grows). Depends on the board size only, so the snake never
 * reflows while a hand is being played.
 */
export function bestLimit(width: number, height: number): number {
  if (!width || !height) return DEFAULT_LIMIT;
  let best = DEFAULT_LIMIT;
  let bestScore = 0;
  for (let limit = 4; limit <= 10; limit++) {
    const score = REFERENCE_CHAINS.reduce((sum, chain) => {
      const [, , vw, vh] = layoutBoard(chain, chain.length >> 1, limit).viewBox;
      return sum + Math.min(width / vw, height / vh);
    }, 0);
    if (score >= bestScore * 0.99) {
      best = limit;
      bestScore = Math.max(score, bestScore);
    }
  }
  return best;
}

/** Chains without doubles, played out from the middle: what bestLimit sizes the board for. */
const referenceChain = (n: number): Placed[] => Array.from({ length: n }, (_, i) => ({ a: i % 6, b: (i + 1) % 6, seat: (i % 4) as Seat }));
const REFERENCE_CHAINS = [referenceChain(14), referenceChain(22)];

const keyOf = (p: Placed) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`;

/**
 * Lays the line out as the classic snake: the first tile in the middle, the
 * right arm running right then turning down, the left arm running left then
 * turning up. Doubles sit crosswise, except on a corner.
 */
export function layoutBoard(line: Placed[], origin: number, limit = DEFAULT_LIMIT): BoardLayout {
  const tiles: LaidTile[] = [];
  const ends: ArmEnd[] = [];

  if (line.length === 0) {
    return { tiles, ends, viewBox: [-limit - 1.5, -3.5, 2 * limit + 3, 7] };
  }

  const center = line[origin];
  const centerDouble = center.a === center.b;
  const half = centerDouble ? 0.5 : 1;
  tiles.push(centerDouble
    ? { key: keyOf(center), x: -0.5, y: -1, vertical: true, first: center.a, second: center.b, seat: center.seat }
    : { key: keyOf(center), x: -1, y: -0.5, vertical: false, first: center.a, second: center.b, seat: center.seat });

  const right = line.slice(origin + 1).map((p) => ({ near: p.a, far: p.b, p }));
  const left = line.slice(0, origin).reverse().map((p) => ({ near: p.b, far: p.a, p }));

  layArm(right, half, 'E', 'S', 'R', tiles, ends, limit);
  layArm(left, -half, 'W', 'N', 'L', tiles, ends, limit);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    maxX = Math.max(maxX, t.x + (t.vertical ? 1 : 2));
    minY = Math.min(minY, t.y);
    maxY = Math.max(maxY, t.y + (t.vertical ? 2 : 1));
  }
  for (const e of ends) {
    minX = Math.min(minX, e.x - 0.8);
    maxX = Math.max(maxX, e.x + 0.8);
    minY = Math.min(minY, e.y - 0.7);
    maxY = Math.max(maxY, e.y + 0.7);
  }
  const pad = 0.8;
  let h = maxY - minY + pad * 2;
  let y0 = minY - pad;
  if (h < 4.5) {
    y0 -= (4.5 - h) / 2;
    h = 4.5;
  }
  const w = Math.max(8.5, maxX - minX + pad * 2);
  return { tiles, ends, viewBox: [(minX + maxX - w) / 2, y0, w, h] };
}

function layArm(
  arm: { near: number; far: number; p: Placed }[],
  startX: number,
  dir: 'E' | 'W',
  turn: 'S' | 'N',
  side: 'L' | 'R',
  out: LaidTile[],
  ends: ArmEnd[],
  limit: number,
) {
  let cx = startX;
  let cy = 0;
  let d = dir;
  let justTurned = false;

  for (const { near, far, p } of arm) {
    const double = near === far;
    const crosswise = double && !justTurned;
    const len = crosswise ? 1 : 2;
    const nx = d === 'E' ? cx + len : cx - len;

    if (!justTurned && Math.abs(nx) > limit) {
      // Corner: the tile stands upright and the snake heads back the other way.
      out.push({
        key: keyOf(p),
        x: d === 'E' ? cx : cx - 1,
        y: turn === 'S' ? cy - 0.5 : cy - 1.5,
        vertical: true,
        first: turn === 'S' ? near : far,
        second: turn === 'S' ? far : near,
        seat: p.seat,
      });
      cy = turn === 'S' ? cy + 2 : cy - 2;
      cx = d === 'E' ? cx + 1 : cx - 1;
      d = d === 'E' ? 'W' : 'E';
      justTurned = true;
      continue;
    }

    if (crosswise) {
      out.push({ key: keyOf(p), x: d === 'E' ? cx : cx - 1, y: cy - 1, vertical: true, first: near, second: far, seat: p.seat });
    } else {
      out.push({
        key: keyOf(p),
        x: d === 'E' ? cx : cx - 2,
        y: cy - 0.5,
        vertical: false,
        first: d === 'E' ? near : far,
        second: d === 'E' ? far : near,
        seat: p.seat,
      });
    }
    cx = nx;
    justTurned = false;
  }

  // Reserve enough breathing room for a 44px touch target, even on small phones.
  ends.push({ side, x: d === 'E' ? cx + 1.4 : cx - 1.4, y: cy });
}

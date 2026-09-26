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

/** Half-width of a row before the snake turns. */
const LIMIT = 5;

const keyOf = (p: Placed) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`;

/**
 * Lays the line out as the classic snake: the first tile in the middle, the
 * right arm running right then turning down, the left arm running left then
 * turning up. Doubles sit crosswise, except on a corner.
 */
export function layoutBoard(line: Placed[], origin: number): BoardLayout {
  const tiles: LaidTile[] = [];
  const ends: ArmEnd[] = [];

  if (line.length === 0) {
    return { tiles, ends, viewBox: [-LIMIT - 1.5, -3.5, 2 * LIMIT + 3, 7] };
  }

  const center = line[origin];
  const centerDouble = center.a === center.b;
  const half = centerDouble ? 0.5 : 1;
  tiles.push(centerDouble
    ? { key: keyOf(center), x: -0.5, y: -1, vertical: true, first: center.a, second: center.b, seat: center.seat }
    : { key: keyOf(center), x: -1, y: -0.5, vertical: false, first: center.a, second: center.b, seat: center.seat });

  const right = line.slice(origin + 1).map((p) => ({ near: p.a, far: p.b, p }));
  const left = line.slice(0, origin).reverse().map((p) => ({ near: p.b, far: p.a, p }));

  layArm(right, half, 'E', 'S', 'R', tiles, ends);
  layArm(left, -half, 'W', 'N', 'L', tiles, ends);

  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minY = Math.min(minY, t.y);
    maxY = Math.max(maxY, t.y + (t.vertical ? 2 : 1));
  }
  for (const e of ends) {
    minY = Math.min(minY, e.y - 0.7);
    maxY = Math.max(maxY, e.y + 0.7);
  }
  const pad = 0.8;
  let h = maxY - minY + pad * 2;
  let y0 = minY - pad;
  if (h < 7) {
    y0 -= (7 - h) / 2;
    h = 7;
  }
  return { tiles, ends, viewBox: [-LIMIT - 1.5, y0, 2 * LIMIT + 3, h] };
}

function layArm(
  arm: { near: number; far: number; p: Placed }[],
  startX: number,
  dir: 'E' | 'W',
  turn: 'S' | 'N',
  side: 'L' | 'R',
  out: LaidTile[],
  ends: ArmEnd[],
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

    if (!justTurned && Math.abs(nx) > LIMIT) {
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

  ends.push({ side, x: d === 'E' ? cx + 0.7 : cx - 0.7, y: cy });
}

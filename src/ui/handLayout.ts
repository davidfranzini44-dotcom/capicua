// How my hand fits the bottom of the screen. A 1v1 player who keeps drawing can
// end up holding 15+ tiles, which used to run off the side of a phone.

export const HAND_GAP = 5;      // px between tiles in a row
export const HAND_ROW_GAP = 8;  // px between rows
const MAX_TILE = 56;            // widest a hand tile gets
const MIN_TILE = 30;            // below this, a second row beats shrinking further
const MAX_HEIGHT = 150;         // the hand never takes more than this from the board
const TILE_RATIO = 2.1 / 1.04;  // height / width of a standing tile (see HandTile's viewBox)

/**
 * Tiles per row and tile width (px) for `n` tiles in a strip `width` px wide.
 * One row while tiles stay comfortably big; otherwise the fewest rows that
 * keep them big, never taller than MAX_HEIGHT.
 */
export function handLayout(n: number, width: number, maxTile = MAX_TILE): { perRow: number; tile: number; rows: number } {
  const count = Math.max(n, 1);
  let best = { perRow: count, tile: 0, rows: 1 };
  for (let rows = 1; rows <= 3; rows++) {
    const perRow = Math.ceil(count / rows);
    const tile = Math.floor(Math.min(
      maxTile,
      (width - (perRow - 1) * HAND_GAP) / perRow,
      (MAX_HEIGHT - (rows - 1) * HAND_ROW_GAP) / rows / TILE_RATIO,
    ));
    if (tile >= MIN_TILE) return { perRow, tile, rows: Math.ceil(count / perRow) };
    if (tile > best.tile) best = { perRow, tile, rows: Math.ceil(count / perRow) };
  }
  return best;
}

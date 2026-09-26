import { describe, expect, it } from 'vitest';
import { layoutBoard } from '../src/ui/boardLayout';
import { applyMove, newGame } from '../supabase/functions/_shared/domino';
import { chooseMove } from '../supabase/functions/_shared/bot';

describe('responsive board bounds', () => {
  it('keeps the first few tiles large rather than reserving a full empty snake', () => {
    const { viewBox } = layoutBoard([{ a: 3, b: 5, seat: 0 }, { a: 5, b: 6, seat: 1 }, { a: 6, b: 6, seat: 2 }], 2);
    expect(viewBox[2]).toBeLessThan(13);
  });
  it('keeps every tile and both end controls inside the viewport through complete games', () => {
    let seed = 42;
    const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let round = 0; round < 20; round++) {
      let game = newGame(rng);
      while (!game.handResult) {
        game = applyMove(game, chooseMove(game, game.turn));
        const { tiles, ends, viewBox: [x, y, w, h] } = layoutBoard(game.line, game.origin);
        for (const tile of tiles) {
          expect(tile.x).toBeGreaterThanOrEqual(x);
          expect(tile.y).toBeGreaterThanOrEqual(y);
          expect(tile.x + (tile.vertical ? 1 : 2)).toBeLessThanOrEqual(x + w);
          expect(tile.y + (tile.vertical ? 2 : 1)).toBeLessThanOrEqual(y + h);
        }
        for (const end of ends) {
          expect(end.x - .8).toBeGreaterThanOrEqual(x);
          expect(end.x + .8).toBeLessThanOrEqual(x + w);
          expect(end.y - .7).toBeGreaterThanOrEqual(y);
          expect(end.y + .7).toBeLessThanOrEqual(y + h);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { HAND_GAP, handLayout } from '../src/ui/handLayout';

const rowWidth = (perRow: number, tile: number) => perRow * tile + (perRow - 1) * HAND_GAP;

describe('handLayout', () => {
  it('keeps a normal hand in one row at full size on a wide screen', () => {
    expect(handLayout(7, 700)).toEqual({ perRow: 7, tile: 56, rows: 1 });
  });

  it('shrinks a 7-tile hand to fit a small phone', () => {
    const l = handLayout(7, 344);
    expect(l.rows).toBe(1);
    expect(rowWidth(l.perRow, l.tile)).toBeLessThanOrEqual(344);
  });

  it('wraps a big 1v1 hand into balanced rows instead of running off screen', () => {
    for (const width of [304, 344, 374, 412]) {
      for (let n = 1; n <= 21; n++) {
        const l = handLayout(n, width);
        expect(rowWidth(l.perRow, l.tile)).toBeLessThanOrEqual(width);
        expect(l.perRow * l.rows).toBeGreaterThanOrEqual(n);
        expect(l.tile).toBeGreaterThanOrEqual(22); // still tappable
      }
    }
    const l = handLayout(15, 344);
    expect(l).toMatchObject({ perRow: 8, rows: 2 });
  });

  it('never gets taller than two comfortable rows for a realistic hand', () => {
    for (let n = 1; n <= 21; n++) expect(handLayout(n, 344).rows).toBeLessThanOrEqual(2);
  });
});

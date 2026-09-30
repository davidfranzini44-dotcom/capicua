// Where someone finished, for their tournament history and the podium.
import { describe, expect, it } from 'vitest';
import { finishOf, metalOf } from '../src/lib/tournamentPlace';

describe('finishOf', () => {
  it('reads the placings the server writes (placementFor)', () => {
    expect(finishOf(1, null, 3)).toEqual({ kind: 'champion' });
    expect(finishOf(2, 3, 3)).toEqual({ kind: 'runnerUp' });
    expect(finishOf(3, 2, 3)).toEqual({ kind: 'semi' });
    expect(finishOf(5, 1, 3)).toEqual({ kind: 'out', stage: 'quarter' });
    expect(finishOf(9, 1, 4)).toEqual({ kind: 'out', stage: 'r16' });
    expect(finishOf(null, null, null)).toEqual({ kind: 'out', stage: null });
  });
  it('gold, silver and bronze for the top three only', () => {
    expect([1, 2, 3, 5].map((p) => metalOf(finishOf(p, 1, 3)))).toEqual(['gold', 'silver', 'bronze', null]);
  });
});

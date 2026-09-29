import { describe, expect, it } from 'vitest';
import { nameKey, nextRename, RENAME_DAYS } from '../src/lib/names';

describe('player names', () => {
  it('compare like the server: capitals, accents, spaces and punctuation don\'t count', () => {
    const k = nameKey('David');
    for (const same of ['david', 'DÁVID', ' Da-vid ', 'Da.vid', 'D a v i d']) expect(nameKey(same)).toBe(k);
    expect(nameKey('Toño')).toBe('tono');
    expect(nameKey('José 2')).toBe('jose2');
    expect(nameKey('David2')).not.toBe(k);
    // Only symbols: the name itself (lower case) is what must be unique.
    expect(nameKey(' 🔥🔥 ')).toBe('🔥🔥');
  });

  it('a name changes again 7 days after the last change', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(nextRename(null, now)).toBeNull();
    expect(nextRename('2026-09-20T12:00:00Z', now)).toBeNull();
    expect(nextRename('2026-09-27T12:00:00Z', now)).toBe(Date.parse('2026-09-27T12:00:00Z') + RENAME_DAYS * 86_400_000);
  });
});

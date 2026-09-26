import { describe, expect, it } from 'vitest';
import { clientIp, networkOf, pairKey, pickGroup, shuffled } from '../supabase/functions/_shared/fairplay.ts';

describe('networks', () => {
  it('reads the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '190.80.1.2, 10.0.0.1' }))).toBe('190.80.1.2');
    expect(clientIp(new Headers({ 'cf-connecting-ip': '190.80.1.3' }))).toBe('190.80.1.3');
    expect(clientIp(new Headers())).toBeNull();
  });

  it('keeps public IPv4 addresses whole', () => {
    expect(networkOf('190.80.1.2')).toBe('190.80.1.2');
    expect(networkOf('190.080.1.2:4433')).toBe('190.80.1.2');
    expect(networkOf('::ffff:190.80.1.2')).toBe('190.80.1.2');
  });

  it('ignores private, local and broken addresses', () => {
    for (const ip of ['10.1.2.3', '192.168.0.4', '172.20.0.1', '127.0.0.1', '100.70.1.1', '169.254.1.1', '::1', 'fe80::1', 'fd00::5', '999.1.1.1', 'hola', '', null]) {
      expect(networkOf(ip), String(ip)).toBeNull();
    }
  });

  it('cuts IPv6 to the home network (/64)', () => {
    expect(networkOf('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
    expect(networkOf('2001:DB8:ABCD:0012::99')).toBe('2001:db8:abcd:12::/64');
    expect(networkOf('[2001:db8:abcd:12::7]:443')).toBe('2001:db8:abcd:12::/64');
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(networkOf('2001:db8:1:2:3')).toBeNull();
  });
});

describe('picking a table from the queue', () => {
  const clashOf = (pairs: [string, string][]) => {
    const set = new Set(pairs.map(([a, b]) => pairKey(a, b)));
    return (a: string, b: string) => set.has(pairKey(a, b));
  };

  it('is plain first-come first-served when nobody knows each other', () => {
    expect(pickGroup(['A', 'B', 'C', 'D', 'E'], 4, () => false)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('never seats a pair of friends together', () => {
    expect(pickGroup(['A', 'B', 'C', 'D', 'E'], 4, clashOf([['A', 'B']]))).toEqual(['A', 'C', 'D', 'E']);
  });

  it('skips everyone who knows someone already chosen', () => {
    // A–B and B–C know each other; C is fine with A.
    expect(pickGroup(['A', 'B', 'C', 'D'], 2, clashOf([['A', 'B'], ['B', 'C']]))).toEqual(['A', 'C']);
  });

  it("lets the others play when the oldest player can't complete a table", () => {
    // A knows both B and C; B and C can still play each other.
    expect(pickGroup(['A', 'B', 'C'], 2, clashOf([['A', 'B'], ['A', 'C']]))).toEqual(['B', 'C']);
  });

  it('returns the biggest partial group when no full table exists', () => {
    const got = pickGroup(['A', 'B', 'C'], 4, clashOf([['A', 'B']]));
    expect(got).toHaveLength(2);
    expect(got).toContain('C');
  });

  it('keeps queue order in the result', () => {
    expect(pickGroup(['D', 'A', 'C', 'B'], 3, clashOf([['D', 'A']]))).toEqual(['D', 'C', 'B']);
  });
});

describe('shuffle', () => {
  it('keeps every item', () => {
    expect(shuffled([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });

  it('puts each item first about equally often', () => {
    const firsts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) firsts[shuffled([0, 1, 2, 3])[0]]++;
    for (const n of firsts) expect(Math.abs(n - 2000)).toBeLessThan(250);
  });
});

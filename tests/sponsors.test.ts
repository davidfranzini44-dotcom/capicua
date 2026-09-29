import { describe, expect, it } from 'vitest';
import { normalizeLink, pickWeighted, SPONSOR_SALAS, sponsorMatches, validateSponsor, type SponsorInput } from '../supabase/functions/_shared/sponsors.ts';

const base: SponsorInput = {
  name: 'Colmado La Esquina', imagePath: 'k3j2-abc.webp', link: null, style: 'color', opacity: 0.4, size: 0.6,
  salas: [500, 1000], custom: false, tournaments: false, tournamentCodes: [], weight: 1,
  startsAt: '2026-10-01T00:00:00.000Z', endsAt: null, paused: false, maxViews: null,
};

describe('sponsor links', () => {
  it('turns what the admin types into an https link', () => {
    expect(normalizeLink('https://colmado.do/ofertas')).toBe('https://colmado.do/ofertas');
    expect(normalizeLink('http://colmado.do')).toBe('https://colmado.do/');
    expect(normalizeLink('colmado.do')).toBe('https://colmado.do/');
    expect(normalizeLink('@colmadolaesquina')).toBe('https://instagram.com/colmadolaesquina');
    expect(normalizeLink('809-555-1234')).toBe('https://wa.me/18095551234');
    expect(normalizeLink('+1 (829) 555 1234')).toBe('https://wa.me/18295551234');
  });

  it('rejects anything that is not a web link', () => {
    expect(normalizeLink('')).toBeNull();
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('hola')).toBeNull();
    expect(normalizeLink('ftp://x.com')).toBeNull();
  });
});

describe('saving a sponsor', () => {
  it('keeps valid settings, tidies the name and clamps the sliders', () => {
    const s = validateSponsor({ ...base, name: '  Colmado   La Esquina ', opacity: 2, size: 0.1, weight: 40, salas: [1000, 500, 500, 777] });
    expect(s).toMatchObject({ name: 'Colmado La Esquina', opacity: 0.9, size: 0.3, weight: 10, salas: [500, 1000] });
  });

  it('a tournament code means tournaments are on; codes are upper-cased', () => {
    expect(validateSponsor({ ...base, salas: [], tournamentCodes: ['kxqtb'] })).toMatchObject({ tournaments: true, tournamentCodes: ['KXQTB'] });
  });

  it('refuses a sponsor with no tables, a bad link, a bad image path or an end before the start', () => {
    expect(validateSponsor({ ...base, salas: [] })).toBeNull();
    expect(validateSponsor({ ...base, link: 'nope' })).toBeNull();
    expect(validateSponsor({ ...base, imagePath: '../x.svg' })).toBeNull();
    expect(validateSponsor({ ...base, endsAt: '2026-09-01T00:00:00.000Z' })).toBeNull();
    expect(validateSponsor({ ...base, name: 'x' })).toBeNull();
  });

  it('a package of views is a whole number from 100 to 10 million, or none', () => {
    expect(validateSponsor({ ...base, maxViews: 5000 })?.maxViews).toBe(5000);
    expect(validateSponsor({ ...base, maxViews: null })?.maxViews).toBeNull();
    expect(validateSponsor({ ...base, maxViews: 50 })).toBeNull();
    expect(validateSponsor({ ...base, maxViews: 1.5 })).toBeNull();
  });

  it('a second logo for the fichas is optional, and must be an uploaded image like the first', () => {
    expect(validateSponsor(base)?.tileImagePath).toBeNull();
    expect(validateSponsor({ ...base, tileImagePath: '' })?.tileImagePath).toBeNull();
    expect(validateSponsor({ ...base, tileImagePath: 'k3j3-tile.png' })?.tileImagePath).toBe('k3j3-tile.png');
    expect(validateSponsor({ ...base, tileImagePath: '../x.svg' })).toBeNull();
    expect(validateSponsor({ ...base, tileImagePath: 'https://evil.example/x.png' })).toBeNull();
  });

  it('offers the friendly tables and every sala', () => {
    expect(SPONSOR_SALAS).toEqual([0, 500, 1000, 1500, 2000]);
  });
});

describe('which tables show it', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  it('public tables by stake, private tables, tournaments (all or by code)', () => {
    expect(sponsorMatches(base, { kind: 'public', stake: 500 }, now)).toBe(true);
    expect(sponsorMatches(base, { kind: 'public', stake: 2000 }, now)).toBe(false);
    expect(sponsorMatches(base, { kind: 'custom', stake: 0 }, now)).toBe(false);
    expect(sponsorMatches({ ...base, custom: true }, { kind: 'custom', stake: 0 }, now)).toBe(true);
    const tour = { ...base, tournaments: true };
    expect(sponsorMatches(tour, { kind: 'tournament', stake: 0, tournamentCode: 'ABCDE' }, now)).toBe(true);
    expect(sponsorMatches({ ...tour, tournamentCodes: ['KXQTB'] }, { kind: 'tournament', stake: 0, tournamentCode: 'ABCDE' }, now)).toBe(false);
    expect(sponsorMatches({ ...tour, tournamentCodes: ['KXQTB'] }, { kind: 'tournament', stake: 0, tournamentCode: 'KXQTB' }, now)).toBe(true);
  });

  it('only while it runs: not paused, started, not ended', () => {
    expect(sponsorMatches({ ...base, paused: true }, { kind: 'public', stake: 500 }, now)).toBe(false);
    expect(sponsorMatches({ ...base, startsAt: '2026-10-06T00:00:00Z' }, { kind: 'public', stake: 500 }, now)).toBe(false);
    expect(sponsorMatches({ ...base, endsAt: '2026-10-05T00:00:00Z' }, { kind: 'public', stake: 500 }, now)).toBe(false);
    expect(sponsorMatches({ ...base, endsAt: '2026-10-06T00:00:00Z' }, { kind: 'public', stake: 500 }, now)).toBe(true);
  });

  it('stops on its own once the views paid for are used', () => {
    const table = { kind: 'public' as const, stake: 500 };
    expect(sponsorMatches({ ...base, maxViews: 5000, viewsUsed: 4999 }, table, now)).toBe(true);
    expect(sponsorMatches({ ...base, maxViews: 5000, viewsUsed: 5000 }, table, now)).toBe(false);
    expect(sponsorMatches({ ...base, maxViews: null, viewsUsed: 99_999 }, table, now)).toBe(true);
  });

  it('several sponsors on the same tables share them by weight', () => {
    const list = [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }];
    expect(pickWeighted(list, () => 0.1)?.id).toBe('a');
    expect(pickWeighted(list, () => 0.74)?.id).toBe('a');
    expect(pickWeighted(list, () => 0.76)?.id).toBe('b');
    expect(pickWeighted([], () => 0.5)).toBeNull();
  });
});

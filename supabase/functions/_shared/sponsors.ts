// Sponsored tables: a company's logo printed on the felt of the tables the admin
// assigns (public salas by stake, private tables, tournaments). One sponsor per
// game, picked when it's dealt, so everyone at the table sees the same one.
// Pure functions — the game function picks and validates, the browser previews.

import { FRIENDLY, SALAS } from './table.ts';

/** Public tables a sponsor can be assigned to, by stake (0 = friendly). */
export const SPONSOR_SALAS: number[] = [FRIENDLY.stake, ...SALAS.map((s) => s.stake)];

export const SPONSOR_LIMITS = {
  /** Faded so it reads as printed on the felt: 10%–90% opacity. */
  opacity: [0.1, 0.9] as const,
  /** Logo width as a share of the table's oval. */
  size: [0.3, 0.9] as const,
  weight: [1, 10] as const,
};

export type SponsorStyle = 'color' | 'white';

export interface SponsorInput {
  id?: string;
  name: string;
  /** Path of the prepared logo in the public `sponsors` bucket. */
  imagePath: string;
  /** Where tapping "Patrocinado por…" goes (https only), or none. */
  link: string | null;
  /** 'color' = the logo as uploaded; 'white' = a white silhouette, like a print on the felt. */
  style: SponsorStyle;
  opacity: number;
  size: number;
  salas: number[];
  custom: boolean;
  tournaments: boolean;
  /** Only these tournaments (by code); empty = every tournament. */
  tournamentCodes: string[];
  /** Several sponsors on the same tables share them in this proportion. */
  weight: number;
  startsAt: string;
  endsAt: string | null;
  paused: boolean;
}

/**
 * Turns what the admin typed into an https link: a full URL, an Instagram
 * @handle, a WhatsApp number (Dominican 809/829/849 numbers get the +1), or a
 * bare domain. Null when empty or not usable.
 */
export function normalizeLink(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let url: string;
  if (/^@[\w.]{1,30}$/.test(s)) url = `https://instagram.com/${s.slice(1)}`;
  else if (/^\+?[\d\s()-]{10,20}$/.test(s)) {
    let digits = s.replace(/\D/g, '');
    if (digits.length === 10 && /^8[024]9/.test(digits)) digits = `1${digits}`;
    url = `https://wa.me/${digits}`;
  } else if (/^https?:\/\//i.test(s)) url = s.replace(/^http:\/\//i, 'https://');
  else url = `https://${s}`;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
const isDate = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

/** What the admin saves, checked and tidied; null if it can't be saved. */
export function validateSponsor(s: Partial<SponsorInput>): SponsorInput | null {
  const name = String(s.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) return null;
  const imagePath = String(s.imagePath ?? '');
  if (!/^[\w-]{1,80}\.(png|webp|jpe?g)$/.test(imagePath)) return null;
  const link = s.link ? normalizeLink(s.link) : null;
  if (s.link && !link) return null;
  if (s.style !== 'color' && s.style !== 'white') return null;
  if (!Number.isFinite(s.opacity) || !Number.isFinite(s.size) || !Number.isInteger(s.weight)) return null;
  const salas = [...new Set((s.salas ?? []).filter((x) => SPONSOR_SALAS.includes(x)))].sort((a, b) => a - b);
  const tournamentCodes = [...new Set((s.tournamentCodes ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (tournamentCodes.some((c) => !/^[A-Z]{5}$/.test(c))) return null;
  const tournaments = !!s.tournaments || tournamentCodes.length > 0;
  if (!salas.length && !s.custom && !tournaments) return null; // it has to go on some table
  const startsAt = isDate(s.startsAt) ? new Date(s.startsAt!).toISOString() : new Date().toISOString();
  const endsAt = s.endsAt ? (isDate(s.endsAt) ? new Date(s.endsAt).toISOString() : null) : null;
  if (s.endsAt && !endsAt) return null;
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  return {
    ...(s.id ? { id: String(s.id) } : {}),
    name, imagePath, link, style: s.style,
    opacity: Math.round(clamp(s.opacity!, SPONSOR_LIMITS.opacity) * 100) / 100,
    size: Math.round(clamp(s.size!, SPONSOR_LIMITS.size) * 100) / 100,
    salas, custom: !!s.custom, tournaments, tournamentCodes,
    weight: clamp(s.weight!, SPONSOR_LIMITS.weight),
    startsAt, endsAt, paused: !!s.paused,
  };
}

export interface SponsorTarget {
  salas: number[]; custom: boolean; tournaments: boolean; tournamentCodes: string[];
  paused: boolean; startsAt: string | Date; endsAt: string | Date | null;
}
export interface TableKind { kind: 'public' | 'custom' | 'tournament'; stake: number; tournamentCode?: string | null }

/** Running now and assigned to this kind of table. */
export function sponsorMatches(s: SponsorTarget, table: TableKind, now = Date.now()): boolean {
  if (s.paused || new Date(s.startsAt).getTime() > now) return false;
  if (s.endsAt && new Date(s.endsAt).getTime() <= now) return false;
  if (table.kind === 'public') return s.salas.includes(table.stake);
  if (table.kind === 'custom') return s.custom;
  return s.tournaments && (s.tournamentCodes.length === 0 || (!!table.tournamentCode && s.tournamentCodes.includes(table.tournamentCode)));
}

/** One of several, in proportion to their weights (null if none). */
export function pickWeighted<T extends { weight: number }>(list: T[], rng: () => number = Math.random): T | null {
  const total = list.reduce((n, x) => n + Math.max(1, x.weight), 0);
  let r = rng() * total;
  for (const x of list) {
    r -= Math.max(1, x.weight);
    if (r < 0) return x;
  }
  return list.at(-1) ?? null;
}

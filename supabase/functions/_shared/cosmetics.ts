// Board looks: felt colors and domino styles. Each player picks their own and
// only they see it. Some are free, some unlock with level, a few cost chips
// (a one-time purchase; chips never turn back into money).
// The server (buy/equip) and the browser (picker, table colors) both read this.

import { levelFromXp } from './table.ts';

export type LookKind = 'felt' | 'tiles';
export type Unlock = { free: true } | { level: number } | { chips: number };

export interface Felt {
  id: string;
  kind: 'felt';
  name: { es: string; en: string };
  unlock: Unlock;
  /** Felt color; the felt texture is tinted with it (null = the texture as drawn). */
  color: string | null;
  /** Solid color behind the texture while it loads, and for small swatches. */
  swatch: string;
}

export interface TileStyle {
  id: string;
  kind: 'tiles';
  name: { es: string; en: string };
  unlock: Unlock;
  face: string;
  edge: string;
  divider: string;
  pip: string;
  /** Per-number pip colors (1–6), for sets with colored dots. */
  pips?: [string, string, string, string, string, string];
}

export type Look = Felt | TileStyle;

export const FELTS: Felt[] = [
  { id: 'verde', kind: 'felt', name: { es: 'Verde clásico', en: 'Classic green' }, unlock: { free: true }, color: null, swatch: '#0b4934' },
  { id: 'azul', kind: 'felt', name: { es: 'Azul marino', en: 'Navy blue' }, unlock: { free: true }, color: '#123e6b', swatch: '#123e6b' },
  { id: 'vino', kind: 'felt', name: { es: 'Rojo vino', en: 'Wine red' }, unlock: { level: 3 }, color: '#6e1a2b', swatch: '#6e1a2b' },
  { id: 'morado', kind: 'felt', name: { es: 'Morado', en: 'Purple' }, unlock: { level: 6 }, color: '#46256e', swatch: '#46256e' },
  { id: 'grafito', kind: 'felt', name: { es: 'Grafito', en: 'Graphite' }, unlock: { level: 10 }, color: '#34393d', swatch: '#34393d' },
  { id: 'turquesa', kind: 'felt', name: { es: 'Turquesa', en: 'Turquoise' }, unlock: { chips: 3000 }, color: '#0b7a78', swatch: '#0b7a78' },
  { id: 'atardecer', kind: 'felt', name: { es: 'Atardecer', en: 'Sunset' }, unlock: { chips: 6000 }, color: '#8a3d12', swatch: '#8a3d12' },
];

export const TILE_STYLES: TileStyle[] = [
  { id: 'marfil', kind: 'tiles', name: { es: 'Marfil', en: 'Ivory' }, unlock: { free: true }, face: '#f7f0e1', edge: '#c9b994', divider: '#a8987a', pip: '#1c1a17' },
  {
    id: 'latino', kind: 'tiles', name: { es: 'Colores', en: 'Colored dots' }, unlock: { free: true },
    face: '#f7f0e1', edge: '#c9b994', divider: '#a8987a', pip: '#1c1a17',
    pips: ['#d62828', '#1f8a70', '#e36414', '#1d4ed8', '#7b2cbf', '#2b6a3f'],
  },
  { id: 'noche', kind: 'tiles', name: { es: 'Noche', en: 'Night' }, unlock: { level: 3 }, face: '#1f1f25', edge: '#44444e', divider: '#5b5b66', pip: '#f4efe3' },
  { id: 'madera', kind: 'tiles', name: { es: 'Madera', en: 'Wood' }, unlock: { level: 6 }, face: '#d7ad74', edge: '#8a6236', divider: '#8a6236', pip: '#2a1a0c' },
  { id: 'nacar', kind: 'tiles', name: { es: 'Nácar', en: 'Pearl' }, unlock: { level: 10 }, face: '#fbfcfd', edge: '#b5c3cf', divider: '#9fb0be', pip: '#1f3344' },
  { id: 'jade', kind: 'tiles', name: { es: 'Jade', en: 'Jade' }, unlock: { chips: 3000 }, face: '#2f8f6f', edge: '#1b5d47', divider: '#1b5d47', pip: '#f7f0e1' },
  { id: 'oro', kind: 'tiles', name: { es: 'Oro', en: 'Gold' }, unlock: { chips: 6000 }, face: '#161616', edge: '#b8860b', divider: '#b8860b', pip: '#f5c542' },
];

export const DEFAULT_FELT = 'verde';
export const DEFAULT_TILES = 'marfil';

export const lookById = (id: string): Look | undefined =>
  FELTS.find((f) => f.id === id) ?? TILE_STYLES.find((t) => t.id === id);
export const feltById = (id: string | null | undefined): Felt => FELTS.find((f) => f.id === id) ?? FELTS[0];
export const tilesById = (id: string | null | undefined): TileStyle => TILE_STYLES.find((t) => t.id === id) ?? TILE_STYLES[0];

/** Whether a player may use a look: free, reached its level, or bought it. */
export function canUse(look: Look, xp: number, owned: ReadonlySet<string>): boolean {
  const u = look.unlock;
  if ('free' in u) return true;
  if ('level' in u) return levelFromXp(xp) >= u.level;
  return owned.has(look.id);
}

export const chipPrice = (look: Look): number | null => ('chips' in look.unlock ? look.unlock.chips : null);

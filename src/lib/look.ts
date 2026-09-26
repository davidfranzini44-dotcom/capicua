// The board look this player chose (felt color + domino style) and what they can pick.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  DEFAULT_FELT, DEFAULT_TILES, feltById, tilesById, type Felt, type TileStyle,
} from '../../supabase/functions/_shared/cosmetics.ts';
import { api, onlineEnabled, supabase, type Profile } from './supabase';

export interface LookState {
  felt: string;
  tiles: string;
  xp: number;
  /** Looks bought with chips. */
  owned: ReadonlySet<string>;
  guest: boolean;
  /** Missing when there's no account (offline practice): the picker hides. */
  equip?: (id: string) => Promise<void>;
  buy?: (id: string) => Promise<void>;
}

export const LookContext = createContext<LookState>({ felt: DEFAULT_FELT, tiles: DEFAULT_TILES, xp: 0, owned: new Set(), guest: false });
export const useLook = () => useContext(LookContext);

/** Looks come from the profile; equipping shows at once and the profile catches up. */
export function useLookState(profile: Profile | null, guest: boolean): LookState {
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ felt?: string; tiles?: string }>({});
  const uid = profile?.id;

  const loadOwned = useCallback(async () => {
    if (!uid || !onlineEnabled) return;
    const { data } = await supabase.from('owned_looks').select('look');
    setOwned(new Set((data ?? []).map((r) => r.look as string)));
  }, [uid]);
  useEffect(() => { loadOwned(); }, [loadOwned]);

  // Once the profile shows what we equipped, drop the local override.
  useEffect(() => {
    setPending((p) => ({
      felt: p.felt && p.felt !== profile?.felt ? p.felt : undefined,
      tiles: p.tiles && p.tiles !== profile?.tiles ? p.tiles : undefined,
    }));
  }, [profile?.felt, profile?.tiles]);

  return useMemo<LookState>(() => {
    const base = {
      felt: pending.felt ?? profile?.felt ?? DEFAULT_FELT,
      tiles: pending.tiles ?? profile?.tiles ?? DEFAULT_TILES,
      xp: profile?.xp ?? 0,
      owned,
      guest,
    };
    if (!uid || !onlineEnabled) return base;
    const show = (id: string) => (feltById(id).id === id ? { felt: id } : { tiles: id });
    return {
      ...base,
      equip: async (id) => {
        const before = pending;
        setPending((p) => ({ ...p, ...show(id) }));
        try { await api('equip_look', { look: id }); } catch (e) { setPending(before); throw e; }
      },
      buy: async (id) => {
        await api('buy_look', { look: id });
        setPending((p) => ({ ...p, ...show(id) }));
        await loadOwned();
      },
    };
  }, [uid, profile?.felt, profile?.tiles, profile?.xp, owned, guest, pending, loadOwned]);
}

/** CSS variables that paint a table (felt tint + domino colors) — put them on the table's root. */
export function lookVars(felt: Felt, tiles: TileStyle): CSSProperties {
  const vars: Record<string, string> = {
    '--felt-swatch': felt.swatch,
    '--tile-face': tiles.face,
    '--tile-edge': tiles.edge,
    '--tile-divider': tiles.divider,
    '--pip': tiles.pip,
  };
  if (felt.color) vars['--felt-color'] = felt.color;
  tiles.pips?.forEach((c, i) => { vars[`--pip-${i + 1}`] = c; });
  return vars as CSSProperties;
}

/** Classes + variables for the table root, from the current look. */
export function useTableLook(): { className: string; style: CSSProperties } {
  const look = useLook();
  const felt = feltById(look.felt);
  const tiles = tilesById(look.tiles);
  return { className: felt.color ? 'felt-tint' : '', style: lookVars(felt, tiles) };
}

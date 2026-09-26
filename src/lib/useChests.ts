import { useCallback, useEffect, useState } from 'react';
import type { ChestKind } from '../../supabase/functions/_shared/table.ts';
import { supabase } from './supabase';

export interface ChestRow {
  id: string;
  slot: number;
  kind: ChestKind;
  /** null = locked (timer not started). */
  unlock_at: string | null;
  game_id: string | null;
}

/** My chests, live. Only the owner can read them (RLS). */
export function useChests(uid: string | undefined) {
  const [chests, setChests] = useState<ChestRow[]>([]);
  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('chests').select('id, slot, kind, unlock_at, game_id').eq('user_id', uid).order('slot');
    setChests((data ?? []) as ChestRow[]);
  }, [uid]);
  useEffect(() => {
    if (!uid) return;
    load();
    const ch = supabase
      .channel(`chests:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chests', filter: `user_id=eq.${uid}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, load]);
  return { chests, reload: load };
}

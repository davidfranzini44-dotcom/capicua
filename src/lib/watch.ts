// Who is watching a table (friends of the players, see migration 20261001000100_watch).
import { useEffect, useState } from 'react';
import { onlineEnabled, supabase } from './supabase';

/** Names of the friends watching this table right now; the players always see them. */
export function useWatchers(roomId: string | null): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!roomId || !onlineEnabled) return;
    let alive = true;
    const load = async () => {
      const { data: rows } = await supabase.from('room_spectators').select('user_id')
        .eq('room_id', roomId).gt('expires_at', new Date().toISOString());
      const ids = (rows ?? []).map((r) => r.user_id as string);
      if (!ids.length) return alive && setNames([]);
      const { data: ps } = await supabase.from('profiles').select('display_name').in('id', ids);
      if (alive) setNames((ps ?? []).map((p) => p.display_name as string));
    };
    load();
    // New watchers arrive live; someone leaving shows up on the next check (deletes aren't filtered by room).
    const ch = supabase.channel(`watchers:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_spectators', filter: `room_id=eq.${roomId}` }, load)
      .subscribe();
    const every = setInterval(load, 30_000);
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(every); };
  }, [roomId]);
  return names;
}

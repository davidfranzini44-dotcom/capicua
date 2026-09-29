// Who is watching a table (friends of the players, see migration 20261001000100_watch)
// and what they say to it (20261008000000_spectators).
import { useCallback, useEffect, useState } from 'react';
import { ApiError, onlineEnabled, supabase } from './supabase';
import { loadLinkWatchers, type LinkWatchers } from './shareMatch';

export interface Watcher { id: string; name: string }

/** Names of the friends watching this table right now; the players always see them. */
export function useWatchers(roomId: string | null): string[] {
  return useWatcherList(roomId).map((w) => w.name);
}

/** The friends watching this table right now (players and the watchers themselves see them all). */
export function useWatcherList(roomId: string | null): Watcher[] {
  const [names, setNames] = useState<Watcher[]>([]);
  useEffect(() => {
    if (!roomId || !onlineEnabled) return;
    let alive = true;
    const load = async () => {
      const { data: rows } = await supabase.from('room_spectators').select('user_id')
        .eq('room_id', roomId).gt('expires_at', new Date().toISOString());
      const ids = (rows ?? []).map((r) => r.user_id as string);
      if (!ids.length) return alive && setNames([]);
      const { data: ps } = await supabase.from('profiles').select('id, display_name').in('id', ids);
      if (alive) setNames((ps ?? []).map((p) => ({ id: p.id as string, name: p.display_name as string })));
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

/**
 * People watching this table through share links (migration 20261011000000): how many, and
 * the names of those who have one — never who they are otherwise. Checked every 20 s.
 */
export function useLinkWatchers(roomId: string | null, on = true): LinkWatchers {
  const [w, setW] = useState<LinkWatchers>({ count: 0, names: [] });
  useEffect(() => {
    if (!roomId || !on || !onlineEnabled) return;
    let alive = true;
    const load = () => loadLinkWatchers(roomId).then((r) => { if (alive) setW(r ?? { count: 0, names: [] }); }, () => {});
    load();
    const every = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(every); };
  }, [roomId, on]);
  return w;
}

/** Everyone watching, for the 👁 panel: friends by name, then link viewers (named, then "n by link"). */
export function allWatchers(friends: Watcher[], link: LinkWatchers, byLinkLabel: (n: number) => string): { list: Watcher[]; count: number } {
  const named = link.names.filter((n) => !friends.some((f) => f.name === n)).map((name, i) => ({ id: `link-${i}`, name }));
  const rest = Math.max(0, link.count - link.names.length);
  return {
    list: [...friends, ...named, ...(rest ? [{ id: 'link-rest', name: byLinkLabel(rest) }] : [])],
    count: friends.length + link.count,
  };
}

export interface SpectatorMessage { id: number; user_id: string; name: string; body: string; created_at: string }
const SPECTATOR_ERRORS = ['not_watching', 'bad_message', 'too_fast', 'banned', 'name_required'];

/** What spectators have said at this table (the last 30), live; `send` is for spectators only. */
export function useSpectatorChat(roomId: string | null) {
  const [messages, setMessages] = useState<SpectatorMessage[]>([]);
  useEffect(() => {
    if (!roomId || !onlineEnabled) return;
    let alive = true;
    supabase.from('room_messages').select('id, user_id, name, body, created_at').eq('room_id', roomId)
      .order('id', { ascending: false }).limit(30)
      .then(({ data }) => { if (alive) setMessages(((data ?? []) as SpectatorMessage[]).reverse()); });
    const ch = supabase.channel(`room-messages:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` }, (p) => {
        const m = p.new as SpectatorMessage;
        setMessages((all) => (all.some((x) => x.id === m.id) ? all : [...all, m].slice(-30)));
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [roomId]);
  const send = useCallback(async (text: string) => {
    const { error } = await supabase.rpc('spectator_say', { p_room: roomId, p_text: text });
    if (error) throw new ApiError(SPECTATOR_ERRORS.includes(error.message) ? error.message : 'server_error');
  }, [roomId]);
  return { messages, send };
}

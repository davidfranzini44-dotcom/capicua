// Friends, who's online, and table invites — one shared state for the whole app.
//
// Online status is Realtime presence on one app-wide channel (only the user id
// and "at a table or not" are shared). Friend lists and invites are rows the
// player can read (RLS); every change goes through the `game` edge function.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onlineEnabled, supabase } from './supabase';

export type Presence = 'online' | 'playing';
export type FriendState = 'friend' | 'incoming' | 'outgoing';

export interface Friend {
  id: string;
  name: string;
  avatar: string | null;
  xp: number;
  state: FriendState;
}

export interface InviteDetails {
  kind: 'room' | 'tournament';
  from: string;
  mode: string;
  stake: number;
  code: string;
  target?: number;
  /** 'arcade' for a Capicúa Arcade table (older invites have none: Traditional). */
  ruleset?: string;
  name?: string;
}

export interface Invite {
  id: string;
  from_user: string;
  to_user: string;
  room_id: string | null;
  tournament_id: string | null;
  details: InviteDetails;
  status: 'sent' | 'accepted' | 'declined';
  expires_at: string;
}

export type InviteTarget = { roomId: string } | { tournamentId: string };

export interface Social {
  uid: string;
  friends: Friend[];
  /** Who has the app open right now (any player, not just friends). */
  online: Map<string, Presence>;
  /** Invites to me that are still open. */
  invites: Invite[];
  /** Invites I sent (latest per friend), to show "invited ✓ / coming / can't". */
  sent: Invite[];
  stateOf: (userId: string) => FriendState | 'none';
  request: (to: { code: string } | { userId: string }) => Promise<{ status: 'pending' | 'accepted'; name: string }>;
  respond: (userId: string, accept: boolean) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  invite: (userId: string, target: InviteTarget) => Promise<boolean>;
  answer: (invite: Invite, accept: boolean) => Promise<{ roomId: string | null; tournamentId: string | null }>;
  /** Dismiss an invite on this screen without answering (it expires on its own). */
  hide: (inviteId: string) => void;
}

export const SocialContext = createContext<Social | null>(null);
/** null when signed out or offline: friend features simply don't show. */
export const useSocial = () => useContext(SocialContext);

const live = (i: Invite) => i.status === 'sent' && new Date(i.expires_at).getTime() > Date.now();

/** Tracks me as online (with what I'm doing) and keeps friends + invites fresh. */
export function useSocialState(uid: string | undefined, presence: Presence): Social | null {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [online, setOnline] = useState<Map<string, Presence>>(new Map());
  const [invites, setInvites] = useState<Invite[]>([]);
  const [sent, setSent] = useState<Invite[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  const loadFriends = useCallback(async () => {
    if (!uid) return;
    const { data: rows } = await supabase.from('friendships').select('user_a, user_b, requested_by, status');
    const ids = (rows ?? []).map((r) => (r.user_a === uid ? r.user_b : r.user_a));
    if (!ids.length) return setFriends([]);
    const { data: ps } = await supabase.from('profiles').select('id, display_name, avatar_url, xp').in('id', ids);
    const byId = new Map((ps ?? []).map((p) => [p.id, p]));
    setFriends((rows ?? []).flatMap((r) => {
      const id = r.user_a === uid ? r.user_b : r.user_a;
      const p = byId.get(id);
      if (!p) return [];
      const state: FriendState = r.status === 'accepted' ? 'friend' : r.requested_by === uid ? 'outgoing' : 'incoming';
      return [{ id, name: p.display_name, avatar: p.avatar_url, xp: p.xp, state }];
    }));
  }, [uid]);

  const loadInvites = useCallback(async () => {
    if (!uid) return;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data } = await supabase.from('table_invites').select('*').gt('expires_at', since).order('created_at', { ascending: false });
    const all = (data ?? []) as Invite[];
    setInvites(all.filter((i) => i.to_user === uid && live(i)));
    setSent(all.filter((i) => i.from_user === uid));
  }, [uid]);

  // Lists: now, on any change that reaches me, when the app comes back to the front, and every minute
  // (removals don't arrive as live events).
  useEffect(() => {
    if (!uid || !onlineEnabled) return;
    loadFriends();
    loadInvites();
    const ch = supabase.channel(`social:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_a=eq.${uid}` }, loadFriends)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `user_b=eq.${uid}` }, loadFriends)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_invites', filter: `to_user=eq.${uid}` }, loadInvites)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_invites', filter: `from_user=eq.${uid}` }, loadInvites)
      .subscribe();
    const refresh = () => { if (document.visibilityState === 'visible') { loadFriends(); loadInvites(); } };
    document.addEventListener('visibilitychange', refresh);
    const every = setInterval(() => { refresh(); setTick((n) => n + 1); }, 60_000);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(every);
    };
  }, [uid, loadFriends, loadInvites]);

  // Presence: one app-wide channel, keyed by user id.
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const status = useRef(presence);
  status.current = presence;
  useEffect(() => {
    if (!uid || !onlineEnabled) return;
    const ch = supabase.channel('players-online', { config: { presence: { key: uid } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ status: Presence }>();
      setOnline(new Map(Object.entries(state).map(([id, metas]) => [id, metas.some((m) => m.status === 'playing') ? 'playing' : 'online'])));
    }).subscribe((s) => {
      if (s === 'SUBSCRIBED') ch.track({ status: status.current });
    });
    channel.current = ch;
    return () => { channel.current = null; supabase.removeChannel(ch); };
  }, [uid]);
  useEffect(() => { channel.current?.track({ status: presence }); }, [presence]);

  const friendMap = useMemo(() => new Map(friends.map((f) => [f.id, f.state])), [friends]);

  return useMemo<Social | null>(() => {
    if (!uid || !onlineEnabled) return null;
    return {
      uid,
      friends,
      online,
      invites: invites.filter((i) => !hidden.has(i.id) && live(i)),
      sent,
      stateOf: (id) => friendMap.get(id) ?? 'none',
      request: async (to) => {
        const r = await api<{ status: 'pending' | 'accepted'; name: string }>('friend_request', to);
        await loadFriends();
        return r;
      },
      respond: async (userId, accept) => { await api('friend_respond', { userId, accept }); await loadFriends(); },
      remove: async (userId) => { await api('friend_remove', { userId }); await loadFriends(); },
      invite: async (userId, target) => {
        const r = await api<{ sent: boolean }>('friend_invite', { userId, ...target });
        await loadInvites();
        return r.sent;
      },
      answer: async (inv, accept) => {
        setHidden((h) => new Set(h).add(inv.id));
        return await api<{ roomId: string | null; tournamentId: string | null }>('invite_respond', { inviteId: inv.id, accept });
      },
      hide: (id) => setHidden((h) => new Set(h).add(id)),
    };
    // tick: re-filter expired invites once a minute
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, friends, online, invites, sent, hidden, friendMap, loadFriends, loadInvites, tick]);
}

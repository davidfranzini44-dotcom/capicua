import { createClient, type Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Online play is available once the Supabase keys are in .env.local. */
export const onlineEnabled = Boolean(url && key);
export const supabase = onlineEnabled ? createClient(url!, key!) : (null as never);

export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** Calls the `game` edge function — the only way the client changes anything. */
export async function api<T = { ok: true }>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('game', { body: { action, ...payload } });
  if (error) {
    let code = 'server_error';
    try {
      code = (await (error as { context?: Response }).context?.json())?.error ?? code;
    } catch { /* not JSON */ }
    throw new ApiError(code);
  }
  return data as T;
}

/**
 * What a sign-in round trip keeps of the page address: invite codes (?sala= table,
 * ?torneo= tournament) and a shared match (?ver=<token>, with ?modo=transmision only
 * alongside it). Leftovers from an earlier try (?error=…, #access_token=…) must not
 * ride along — supabase-js sees an error in the URL and throws the new login away.
 */
export function keptAuthParams(search: string): string {
  const from = new URLSearchParams(search);
  const keep = new URLSearchParams();
  for (const k of ['sala', 'torneo']) {
    const v = from.get(k);
    if (v) keep.set(k, v);
  }
  const ver = from.get('ver');
  if (ver && /^[A-Za-z0-9_-]{40,64}$/.test(ver)) {
    keep.set('ver', ver);
    if (from.get('modo') === 'transmision') keep.set('modo', 'transmision');
  }
  return keep.toString();
}

/** Where Google sends the player back: this page, with only what keptAuthParams keeps. */
export function authReturnUrl() {
  const qs = keptAuthParams(location.search);
  return `${location.origin}${location.pathname}${qs ? `?${qs}` : ''}`;
}

const AUTH_LEFTOVERS = ['error', 'error_code', 'error_description'];

/** Once supabase-js has read the URL, drop what sign-in left there (keeps ?sala / ?compra). */
function tidyAuthUrl() {
  const q = new URLSearchParams(location.search);
  if (!AUTH_LEFTOVERS.some((k) => q.has(k)) && !location.hash) return;
  for (const k of AUTH_LEFTOVERS) q.delete(k);
  const qs = q.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(onlineEnabled);
  useEffect(() => {
    if (!onlineEnabled) return;
    supabase.auth.getSession().then(({ data }) => {
      tidyAuthUrl();
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

export interface Profile {
  id: string;
  display_name: string;
  chips: number;
  xp: number;
  last_daily: string | null;
  last_rescue: string | null;
  avatar_url: string | null;
  /** Short code friends type to add you. */
  friend_code?: string;
  /** Board look (see _shared/cosmetics.ts). */
  felt?: string;
  tiles?: string;
  /** Spectators (watching friends) may hear my voice — on unless I turn it off. */
  spectators_hear?: boolean;
  /** Still has to pick a name (new account, or another player had it first). */
  needs_name?: boolean;
  /** Last name change (a new one is allowed 7 days later). */
  name_changed_at?: string | null;
}

/** A player still choosing their name (older rows: the "Jugador" default). */
export const needsName = (p: Pick<Profile, 'display_name' | 'needs_name'>) => p.needs_name ?? p.display_name === 'Jugador';

/** Ask the signed-in player's profile to load again (after a change the live update may not have brought yet). */
export const reloadProfile = () => window.dispatchEvent(new Event('capicua:profile'));

/** profiles.avatar_url → an <img> src: Google photos are full URLs, uploads live in the public `avatars` bucket. */
export const avatarSrc = (avatar: string | null | undefined) =>
  !avatar ? null : /^(https|data|blob):/.test(avatar) ? avatar : `${url}/storage/v1/object/public/avatars/${avatar}`;

export function useProfile(uid: string | undefined) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    if (!uid) return;
    const load = () =>
      supabase.from('profiles').select('id, display_name, chips, xp, last_daily, last_rescue, avatar_url, friend_code, felt, tiles, spectators_hear, needs_name, name_changed_at').eq('id', uid).single()
        .then(({ data }) => data && setProfile({ ...data, chips: Number(data.chips) }));
    load();
    window.addEventListener('capicua:profile', load);
    const ch = supabase
      .channel(`profile:${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); window.removeEventListener('capicua:profile', load); };
  }, [uid]);
  return profile;
}

/** "Today" for the daily bonus, matching the server's UTC date. */
export const canClaimDaily = (p: Profile | null) => !!p && (!p.last_daily || p.last_daily < new Date().toISOString().slice(0, 10));

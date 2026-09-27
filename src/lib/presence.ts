// "Last online": the app tells the server it's open (the server keeps at most one
// write a minute), and profile cards ask when a player was last here — unless
// that player turned it off in Settings.
import { useEffect, useState } from 'react';
import { onlineEnabled, supabase } from './supabase';

/** Seen this recently counts as "online". */
export const ONLINE_MS = 3 * 60_000;
const HEARTBEAT_MS = 2 * 60_000;

/** While signed in: now, every couple of minutes the app is in front, and whenever it comes back. */
export function usePresenceHeartbeat(active: boolean) {
  useEffect(() => {
    if (!active || !onlineEnabled) return;
    const touch = () => {
      if (document.visibilityState === 'visible') supabase.rpc('touch_presence').then(() => {}, () => {});
    };
    touch();
    const id = setInterval(touch, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', touch);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', touch);
    };
  }, [active]);
}

export interface LastSeen {
  /** When they were last in the app; null if they hide it (or were never seen). */
  at: number | null;
  /** Seen within the last few minutes. */
  online: boolean;
}

/** When a player was last in the app (undefined while loading). */
export function useLastSeen(userId: string | undefined): LastSeen | undefined {
  const [seen, setSeen] = useState<LastSeen & { id: string } | null>(null);
  useEffect(() => {
    if (!userId || !onlineEnabled) return;
    let live = true;
    supabase.rpc('last_seen_of', { p_user: userId }).then(
      ({ data }) => {
        const at = data ? new Date(data as string).getTime() : null;
        if (live) setSeen({ id: userId, at, online: at !== null && Date.now() - at < ONLINE_MS });
      },
      () => { if (live) setSeen({ id: userId, at: null, online: false }); },
    );
    return () => { live = false; };
  }, [userId]);
  return seen && seen.id === userId ? seen : undefined;
}

export async function getShowLastSeen(): Promise<boolean> {
  const { data } = await supabase.rpc('my_presence');
  return (data as { show_last_seen?: boolean } | null)?.show_last_seen ?? true;
}

export async function setShowLastSeen(show: boolean) {
  const { error } = await supabase.rpc('set_last_seen_visible', { p_show: show });
  if (error) throw error;
}

/** "hace 5 minutos" / "5 minutes ago". */
export function timeAgo(at: number, lang: string, justNow: string) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.round(s / 3600), 'hour');
  if (s < 30 * 86_400) return rtf.format(-Math.round(s / 86_400), 'day');
  if (s < 365 * 86_400) return rtf.format(-Math.round(s / (30 * 86_400)), 'month');
  return rtf.format(-Math.round(s / (365 * 86_400)), 'year');
}

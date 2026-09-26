// Juego limpio. Phones never tell a website about screenshots, but sending a
// screenshot or a text on WhatsApp means leaving the app — and that we can see.
// While a hand is on, the player's own app tells the table when they leave,
// when they come back, and when a screenshot key is pressed on a computer.
// The server records it under their seat, so nobody can fake someone else's.

import { useEffect } from 'react';
import { onlineEnabled, supabase } from './supabase';

export type AlertKind = 'left' | 'back' | 'screenshot';

export interface TableAlert {
  id: number;
  user_id: string;
  seat: number;
  kind: AlertKind;
  seconds: number | null;
  /** When it arrived here (ms). */
  at: number;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Mac screenshot shortcuts (⌘⇧3/4/5), when the browser gets to see them. */
const MAC_SHOT = new Set(['3', '4', '5', '#', '$', '%']);
/** On a computer, another window in front for this long counts as leaving. */
const BLUR_GRACE_MS = 3000;

export function useFairPlay(roomId: string, active: boolean) {
  useEffect(() => {
    if (!active || !onlineEnabled) return;
    let token: string | null = null;
    supabase.auth.getSession().then(({ data }) => { token = data.session?.access_token ?? null; });
    const { data: auth } = supabase.auth.onAuthStateChange((_e, s) => { token = s?.access_token ?? null; });

    // 'left' goes out the moment the page hides: the phone may freeze it right after,
    // so it's a keepalive request that finishes even then.
    const sendLeft = () => {
      if (!token || !url || !key) return;
      fetch(`${url}/rest/v1/rpc/fair_play_alert`, {
        method: 'POST',
        keepalive: true,
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_room: roomId, p_kind: 'left', p_seconds: null }),
      }).catch(() => {});
    };
    const send = (kind: AlertKind, seconds: number | null = null) => {
      supabase.rpc('fair_play_alert', { p_room: roomId, p_kind: kind, p_seconds: seconds }).then(() => {}, () => {});
    };

    let leftAt: number | null = null;
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const away = () => {
      if (leftAt !== null) return;
      leftAt = Date.now();
      sendLeft();
    };
    const back = () => {
      clearTimeout(blurTimer);
      if (leftAt === null) return;
      const seconds = Math.round((Date.now() - leftAt) / 1000);
      leftAt = null;
      send('back', seconds);
    };

    // The screen stays on during a hand, so a phone that dims by itself doesn't look like leaving.
    let lock: WakeLockSentinel | null = null;
    const keepAwake = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      navigator.wakeLock.request('screen').then((l) => { lock = l; }, () => {});
    };
    keepAwake();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') away();
      else { back(); keepAwake(); }
    };
    // Computers: another window (WhatsApp Desktop) can cover the game without hiding the page.
    const desktop = matchMedia('(pointer: fine)').matches;
    const onBlur = () => {
      if (!desktop) return;
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => { if (!document.hasFocus()) away(); }, BLUR_GRACE_MS);
    };
    let lastShot = 0;
    const onKey = (e: KeyboardEvent) => {
      const shot = e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && MAC_SHOT.has(e.key));
      if (!shot || Date.now() - lastShot < 3000) return;
      lastShot = Date.now();
      send('screenshot');
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', back);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey); // Windows only reports Print Screen when it's released
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', back);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      clearTimeout(blurTimer);
      auth.subscription.unsubscribe();
      lock?.release().catch(() => {});
    };
  }, [roomId, active]);
}

/** How long a "left the app" mark stays on a seat if they never report coming back. */
export const OUT_OF_APP_MS = 3 * 60_000;

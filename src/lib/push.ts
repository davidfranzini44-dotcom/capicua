// Push notifications on this device: invites, friend requests, "your
// tournament match is ready". The browser holds the subscription; the server
// keeps it per player (push_subscribe) and sends through the `push` function.
import { useCallback, useEffect, useState } from 'react';
import { onlineEnabled, supabase } from './supabase';

/**
 * on / off: this device can get notifications and they're on or off.
 * denied: the player blocked them in the browser (only the browser settings can undo it).
 * install: iPhone/iPad in Safari — notifications only work once Capicúa is on the home screen.
 * unsupported: this browser can't do push at all.
 */
export type PushState = 'on' | 'off' | 'denied' | 'install' | 'unsupported';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function supported(): PushState | null {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return null;
  return isIos() && !standalone() ? 'install' : 'unsupported';
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
}

const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function publicKey(): Promise<string> {
  const { data } = await supabase.rpc('push_public_key');
  if (data) return data as string;
  // First device ever: the push function makes the app's keys.
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push?action=init`;
  const res = await (await fetch(url)).json();
  if (!res.publicKey) throw new Error('no push key');
  return res.publicKey;
}

async function save(sub: PushSubscription, lang: string) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_lang: lang });
  if (error) throw error;
}

export async function pushState(): Promise<PushState> {
  const no = supported();
  if (no) return no;
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Ask the browser (this must run from a tap) and subscribe this device. */
export async function enablePush(lang: string): Promise<PushState> {
  const no = supported();
  if (no) return no;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(await publicKey()) }));
  await save(sub, lang);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  return 'off';
}

/**
 * The device's notification state for the signed-in player. If this device is
 * already subscribed, it's (re)linked to whoever is signed in now, in their
 * language; signing out unsubscribes it so the next person doesn't get the
 * previous player's notifications.
 */
export function usePush(uid: string | undefined, lang: string) {
  const [state, setState] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || !onlineEnabled) return;
    let alive = true;
    pushState().then(async (s) => {
      if (!alive) return;
      setState(s);
      if (s === 'on') {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (sub) save(sub, lang).catch(() => {});
      }
    });
    return () => { alive = false; };
  }, [uid, lang]);

  useEffect(() => {
    if (!onlineEnabled) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT' || !('serviceWorker' in navigator)) return;
      navigator.serviceWorker.getRegistration().then((r) => r?.pushManager.getSubscription()).then((s) => s?.unsubscribe()).catch(() => {});
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush(lang));
    } catch {
      setState(await pushState().catch(() => 'off' as const));
    } finally {
      setBusy(false);
    }
  }, [state, lang]);

  return { state, busy, toggle };
}

export type Push = ReturnType<typeof usePush>;

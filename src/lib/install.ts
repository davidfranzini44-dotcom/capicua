// "Add to home screen". Chrome, Edge and Android hand us an install prompt we
// can fire from our own button; iPhone/iPad never do, so there we explain the
// Share-menu steps. Nothing is offered once the game already runs installed.

import { useEffect, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** prompt = real Install button · ios = Share-menu steps · ios-inapp = open in Safari first */
export type InstallKind = 'installed' | 'prompt' | 'ios' | 'ios-inapp' | 'none';

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

// Listens from startup (main.tsx imports this file): the browser fires the
// event once, often before the game screens have even loaded.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // skip Chrome's own mini-bar; our popup asks at a better moment
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  justInstalled = true;
  deferred = null;
  notify();
});

const ua = navigator.userAgent;
const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Instagram/Facebook/TikTok open links in their own browser, which can't add to the home screen. */
const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|BytedanceWebview|musical_ly/i.test(ua);
const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

function currentKind(): InstallKind {
  if (justInstalled || standalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIos) return inAppBrowser ? 'ios-inapp' : 'ios';
  return 'none';
}

const SNOOZE_KEY = 'capicua.installSnooze';
const SNOOZE_DAYS = 7;

function snoozed() {
  try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now(); } catch { return false; }
}

/** "Not now": don't pop up on its own again for a week (Settings still offers it). */
export function snoozeInstall() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)); } catch { /* private mode */ }
}

export function useInstall() {
  const [kind, setKind] = useState(currentKind);
  useEffect(() => {
    const update = () => setKind(currentKind());
    listeners.add(update);
    update();
    return () => { listeners.delete(update); };
  }, []);
  const available = kind !== 'installed' && kind !== 'none';
  return {
    kind,
    /** Worth a button in Settings. */
    available,
    /** Worth popping up by itself. */
    nudge: available && !snoozed(),
    /** Chrome/Android: open the browser's install dialog. True if they installed. */
    async install() {
      const e = deferred;
      if (!e) return false;
      await e.prompt();
      const { outcome } = await e.userChoice;
      deferred = null; // each prompt works once
      if (outcome !== 'accepted') snoozeInstall();
      notify();
      return outcome === 'accepted';
    },
  };
}

export type Install = ReturnType<typeof useInstall>;

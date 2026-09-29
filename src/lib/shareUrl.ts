// The address of a shared match: …/?ver=<token> to watch, plus &modo=transmision for the
// second-phone broadcast screen. No imports on purpose: the app's first screen reads it.

export const SHARE_PARAM = 'ver';
export const MODE_PARAM = 'modo';
export const BROADCAST_MODE = 'transmision';
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

export interface ShareTarget { token: string; broadcast: boolean }

/** `?ver=` in a page address: the link to open, 'malformed' when it can't be one, null when there's none. */
export function parseShareSearch(search: string): ShareTarget | 'malformed' | null {
  const q = new URLSearchParams(search);
  const token = q.get(SHARE_PARAM);
  if (token === null) return null;
  if (!TOKEN.test(token)) return 'malformed';
  return { token, broadcast: q.get(MODE_PARAM) === BROADCAST_MODE };
}

/** The link to send: to watch, or (broadcast) to open the TikTok screen on a second phone. */
export function shareUrl(token: string, broadcast = false, base = `${location.origin}${location.pathname}`) {
  const q = new URLSearchParams({ [SHARE_PARAM]: token });
  if (broadcast) q.set(MODE_PARAM, BROADCAST_MODE);
  return `${base}?${q}`;
}

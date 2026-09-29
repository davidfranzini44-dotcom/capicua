// Sharing a live match (migration 20261011000000_live_share): the link — …/?ver=<token>,
// plus &modo=transmision for the second-phone broadcast screen — and the calls behind it.
// The token only ever lives in memory and in the link itself: never stored, logged or shown.
import type { Rules, Seat } from '../../supabase/functions/_shared/domino.ts';
import { supabase } from './supabase';

export { BROADCAST_MODE, MODE_PARAM, parseShareSearch, SHARE_PARAM, shareUrl, type ShareTarget } from './shareUrl';

// ---------- calls ----------

export type ShareErrorCode =
  | 'not_signed_in' | 'not_seated' | 'no_live_game' | 'too_many_links' | 'link_invalid' | 'link_gone'
  | 'not_allowed' | 'air_private_only' | 'offline' | 'server_error';
const KNOWN: ShareErrorCode[] = ['not_signed_in', 'not_seated', 'no_live_game', 'too_many_links', 'link_invalid', 'link_gone', 'not_allowed', 'air_private_only'];

/** A failure the screens can word plainly — never the database's own message. */
export class ShareError extends Error {
  code: ShareErrorCode;
  constructor(code: ShareErrorCode) {
    super(code);
    this.code = code;
  }
}
const codeOf = (message: string | undefined): ShareErrorCode =>
  KNOWN.find((k) => message === k) ?? (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'server_error');

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ShareError(codeOf(error.message));
  return data as T;
}

export interface ShareLink { id: string; token: string; expiresAt: number; focusSeat: Seat; gameId: string }

/** A new link for the game I'm playing (the token comes back only here). */
export async function createShareLink(roomId: string, gameId: string): Promise<ShareLink> {
  const r = await call<{ id: string; token: string; expires_at: string; focus_seat: number }>('create_room_share_link', { p_room: roomId });
  return { id: r.id, token: r.token, expiresAt: Date.parse(r.expires_at), focusSeat: r.focus_seat as Seat, gameId };
}
export const revokeShareLink = (id: string) => call<null>('revoke_room_share_link', { p_link: id });
/** Links still open on my table's game (ids only), to turn off after reopening the app. */
export const activeShareLinks = (roomId: string) =>
  call<{ id: string; mine: boolean; expires_at: string }[]>('room_share_links_active', { p_room: roomId });

export interface Redeemed { roomId: string; gameId: string; focusSeat: Seat; player: boolean }
export async function redeemShare(token: string): Promise<Redeemed> {
  const r = await call<{ room_id: string; game_id: string; focus_seat: number; player: boolean }>('watch_shared_match', { p_token: token });
  return { roomId: r.room_id, gameId: r.game_id, focusSeat: r.focus_seat as Seat, player: r.player };
}

/**
 * How many watch by link (not counting friends already listed), and the names of those who
 * have one; the seats whose voice is on air for them (migration 20261012000000_share_voice);
 * and, for the table's players only, the voice identities of everyone watching by link now.
 */
export interface LinkWatchers { count: number; names: string[]; on_air?: number[]; air?: string[] | null }

/** The table as a link viewer may see it: no join code, the players' faces, the link's end. */
export interface SharedRoomInfo {
  room: { id: string; kind: 'public' | 'custom' | 'tournament'; mode: '1v1' | '2v2' | 'ffa'; rules: Rules; stake: number;
    turn_seconds: number; phase: 'lobby' | 'ready' | 'countdown' | 'playing' | 'finished'; current_game: string | null; tournament_id: string | null };
  game_id: string;
  focus_seat: Seat;
  ends_at: string;
  players: { seat: Seat; avatar_url: string | null }[];
  watchers: LinkWatchers | null;
}
/** Also keeps the viewer counted; fails with link_gone once the link stops opening the game. */
export const loadSharedRoom = (roomId: string) => call<SharedRoomInfo>('shared_room', { p_room: roomId });
export const loadLinkWatchers = (roomId: string) => call<LinkWatchers | null>('room_share_watchers', { p_room: roomId });
/** "Mi voz al aire" at this (private) table, on or off. */
export const setVoiceOnAir = (roomId: string, on: boolean) => call<boolean>('set_voice_on_air', { p_room: roomId, p_on: on });
export const leaveShared = (roomId: string) => supabase.rpc('leave_shared_match', { p_room: roomId }).then(() => {}, () => {});

// ---------- sending it ----------

export type ShareOutcome = 'shared' | 'cancelled' | 'unavailable' | 'failed';

/** The phone's share sheet. Closing it without picking an app is 'cancelled' — not an error. */
export async function nativeShare(data: ShareData, nav: Pick<Navigator, 'share' | 'canShare'> = navigator): Promise<ShareOutcome> {
  if (typeof nav.share !== 'function' || (typeof nav.canShare === 'function' && !nav.canShare(data))) return 'unavailable';
  try {
    await nav.share(data);
    return 'shared';
  } catch (e) {
    return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** Copy to the clipboard; true only when it really was copied. */
export async function copyText(text: string, nav: Pick<Navigator, 'clipboard'> = navigator, doc: Document | null = typeof document === 'undefined' ? null : document): Promise<boolean> {
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch { /* permission denied: try the old way */ }
  if (!doc) return false;
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

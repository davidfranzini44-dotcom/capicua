// Player names are unique — capitals, accents, spaces and punctuation don't count
// ("David" = "dávid") — so the name at the table is always one person. Checking a
// name as it's typed, taking it, and when it may change again (once every 7 days).
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type NameError = 'name_length' | 'name_reserved' | 'name_taken' | 'name_cooldown' | 'not_signed_in' | 'server_error';
export interface NameResult { ok: boolean; name?: string; error?: NameError; suggestions?: string[]; until?: string }

export const RENAME_DAYS = 7;
export const NAME_MIN = 2;
/** 12 at most: the whole name fits in a seat at the table, even on small phones. */
export const NAME_MAX = 12;

/** A starting point for a name that's too long: the whole words that fit ("el papá de ustedes" → "el papá de"). */
export function fitName(name: string): string {
  const s = name.trim().replace(/\s+/g, ' ');
  if (s.length <= NAME_MAX) return s;
  let out = '';
  for (const w of s.split(' ')) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > NAME_MAX) break;
    out = next;
  }
  return out || s.slice(0, NAME_MAX);
}

/** The same comparison the server makes (profiles.name_key), to spot "that's already my name". */
export const nameKey = (s: string) =>
  s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') || s.trim().toLowerCase();

type Rpc = (fn: 'name_check' | 'set_display_name', args: { p_name: string }) => PromiseLike<{ data: unknown; error: unknown }>;
let rpc: Rpc = (fn, args) => supabase.rpc(fn, args);
/** Design previews answer these without a server. */
export const setNameRpc = (f: Rpc) => { rpc = f; };

async function call(fn: 'name_check' | 'set_display_name', name: string): Promise<NameResult> {
  const { data, error } = await rpc(fn, { p_name: name });
  if (error || !data) return { ok: false, error: 'server_error' };
  return data as NameResult;
}
export const checkName = (name: string) => call('name_check', name);
export const takeName = (name: string) => call('set_display_name', name);

/** When the name may change again, or null if it can now. */
export function nextRename(changedAt: string | null | undefined, now = Date.now()): number | null {
  if (!changedAt) return null;
  const at = Date.parse(changedAt) + RENAME_DAYS * 86_400_000;
  return at > now ? at : null;
}

export type NameState = 'idle' | 'checking' | 'ok' | 'bad';

/**
 * Availability while typing (asked 350 ms after the last key). `current`: the name
 * the player already has — typing it again is "idle", not a change.
 */
export function useNameCheck(name: string, current?: string): { state: NameState; result: NameResult | null } {
  const trimmed = name.trim();
  const same = current !== undefined && nameKey(trimmed) === nameKey(current) && trimmed === current.trim();
  const short = trimmed.length < NAME_MIN || trimmed.length > NAME_MAX;
  const [res, setRes] = useState<{ name: string; result: NameResult } | null>(null);
  useEffect(() => {
    if (same || short) return;
    let live = true;
    const id = setTimeout(() => { checkName(trimmed).then((r) => live && setRes({ name: trimmed, result: r })); }, 350);
    return () => { live = false; clearTimeout(id); };
  }, [trimmed, same, short]);
  if (same) return { state: 'idle', result: null };
  if (short) return { state: trimmed ? 'bad' : 'idle', result: trimmed ? { ok: false, error: 'name_length' } : null };
  if (!res || res.name !== trimmed) return { state: 'checking', result: null };
  return { state: res.result.ok ? 'ok' : 'bad', result: res.result };
}

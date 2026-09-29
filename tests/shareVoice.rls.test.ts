// Table voice for link viewers ("Mi voz al aire"): who may put their voice on air, who learns
// which link listeners to let in, and that it follows the link — on a real Postgres (PGlite)
// running the real migrations.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import BASE from './sql/share_base.sql?raw';
import WATCH from '../supabase/migrations/20261001000100_watch.sql?raw';
import SPECTATORS from '../supabase/migrations/20261008000000_spectators.sql?raw';
import SHARE from '../supabase/migrations/20261011000000_live_share.sql?raw';
import VOICE from '../supabase/migrations/20261012000000_share_voice.sql?raw';

const U = {
  p0: '00000000-0000-4000-8000-000000000000', p1: '00000000-0000-4000-8000-000000000001',
  p2: '00000000-0000-4000-8000-000000000002', q0: '00000000-0000-4000-8000-000000000010',
  friend: '00000000-0000-4000-8000-0000000000f0', viewer: '00000000-0000-4000-8000-0000000000a0',
  named: '00000000-0000-4000-8000-0000000000b0', stranger: '00000000-0000-4000-8000-0000000000c0',
};
const ROOM = '10000000-0000-4000-8000-000000000001'; // private (custom) 2v2
const PUB = '10000000-0000-4000-8000-000000000002'; // public 2v2
const G1 = '20000000-0000-4000-8000-000000000001';
const G_PUB = '20000000-0000-4000-8000-000000000002';

let db: PGlite;

function as<T>(uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}
const call = <T = unknown>(uid: string, sql: string, params: unknown[]) =>
  as(uid, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0].r);
const onAir = (uid: string, room: string, on: boolean) => call<boolean>(uid, 'select public.set_voice_on_air($1, $2) as r', [room, on]);
const watchers = (uid: string, room = ROOM) =>
  call<{ count: number; names: string[]; on_air: number[]; air: string[] | null } | null>(uid, 'select public.room_share_watchers($1) as r', [room]);
const identity = async (link: string, user: string) =>
  (await db.query<{ r: string }>('select public.share_air_identity($1, $2) as r', [link, user])).rows[0].r;
const fails = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toThrow(code); };
type Link = { id: string; token: string };
const share = (uid: string, room = ROOM) => call<Link>(uid, 'select public.create_room_share_link($1) as r', [room]);
const open = (uid: string, token: string) => call(uid, 'select public.watch_shared_match($1) as r', [token]);

beforeAll(async () => {
  db = new PGlite();
  for (const sql of [BASE, WATCH, SPECTATORS, SHARE, VOICE]) await db.exec(sql);
  const people: [string, string, boolean][] = [
    [U.p0, 'Robert', false], [U.p1, 'Yokasta', false], [U.p2, 'Wilfri', false], [U.q0, 'Kirsy', false],
    [U.friend, 'Papo Amigo', false], [U.viewer, 'Jugador', true], [U.named, 'Nadia', false], [U.stranger, 'Extraño', false],
  ];
  for (const [id, name, guest] of people) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, guest]);
    await db.query('insert into public.profiles (id, display_name, needs_name) values ($1, $2, $3)', [id, name, guest]);
  }
  await db.query(`insert into public.rooms (id, code, kind, phase, current_game) values ($1, 'SECRETO', 'custom', 'playing', $2)`, [ROOM, G1]);
  await db.query(`insert into public.games (id, room_id) values ($1, $2)`, [G1, ROOM]);
  const seats: [number, string | null, boolean, string][] = [[0, U.p0, false, 'Robert'], [1, U.p1, false, 'Yokasta'], [2, U.p2, false, 'Wilfri'], [3, null, true, 'Bot']];
  for (const [seat, user, bot, name] of seats) {
    await db.query('insert into public.room_seats (room_id, seat, user_id, is_bot, name) values ($1, $2, $3, $4, $5)', [ROOM, seat, user, bot, name]);
  }
  await db.query(`insert into public.rooms (id, code, kind, phase, current_game) values ($1, 'PUBLICA', 'public', 'playing', $2)`, [PUB, G_PUB]);
  await db.query(`insert into public.games (id, room_id) values ($1, $2)`, [G_PUB, PUB]);
  await db.query(`insert into public.room_seats (room_id, seat, user_id, name) values ($1, 0, $2, 'Kirsy')`, [PUB, U.q0]);
});

describe('putting my voice on air', () => {
  beforeEach(async () => { await db.query('delete from public.room_voice_air'); });

  it('starts off; a player at a private table turns it on and off for their own voice only', async () => {
    expect((await watchers(U.p0))!.on_air).toEqual([]);
    expect(await onAir(U.p1, ROOM, true)).toBe(true);
    expect(await onAir(U.p1, ROOM, true)).toBe(true); // twice is fine
    expect((await watchers(U.p0))!.on_air).toEqual([1]);
    await onAir(U.p0, ROOM, true);
    expect((await watchers(U.p2))!.on_air).toEqual([0, 1]);
    expect(await onAir(U.p1, ROOM, false)).toBe(false);
    expect((await watchers(U.p2))!.on_air).toEqual([0]);
  });

  it('never at a public table, and never for someone not playing at the table', async () => {
    await fails(onAir(U.q0, PUB, true), 'air_private_only');
    await fails(onAir(U.stranger, ROOM, true), 'not_seated');
    await fails(onAir(U.friend, ROOM, true), 'not_seated');
    // Turning it off is always allowed.
    expect(await onAir(U.stranger, ROOM, false)).toBe(false);
    expect((await db.query('select * from public.room_voice_air')).rows).toHaveLength(0);
  });

  it('a player who gives the game up goes off air (a bot never talks)', async () => {
    await onAir(U.p2, ROOM, true);
    await db.query('update public.room_seats set left_game = true where room_id = $1 and seat = 2', [ROOM]);
    expect((await watchers(U.p0))!.on_air).toEqual([]);
    await db.query('update public.room_seats set left_game = false where room_id = $1 and seat = 2', [ROOM]);
  });

  it('nobody reads or writes the table directly, nor calls the helpers', async () => {
    await fails(as(U.p0, (tx) => tx.query('select * from public.room_voice_air')), 'permission denied');
    await fails(as(U.p0, (tx) => tx.query(`insert into public.room_voice_air values ($1, $2)`, [ROOM, U.p0])), 'permission denied');
    await fails(as(U.p0, (tx) => tx.query('select public.share_air_identity($1, $2)', [G1, U.p0])), 'permission denied');
    await fails(as(U.p0, (tx) => tx.query('select public.room_air_seats($1)', [ROOM])), 'permission denied');
    await fails(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select public.set_voice_on_air($1, true)', [ROOM]); }), 'permission denied');
  });
});

describe('who a player lets in', () => {
  beforeEach(async () => {
    await db.query('update public.room_share_links set revoked_at = now() where revoked_at is null');
    await db.query('delete from public.room_share_viewers');
    await db.query('delete from public.room_spectators');
  });

  it('players get the voice identities of everyone watching by a live link — opaque, one per viewer and link', async () => {
    expect((await watchers(U.p0))!.air).toEqual([]);
    const link = await share(U.p0);
    await open(U.viewer, link.token);
    await open(U.named, link.token);
    const w = (await watchers(U.p1))!;
    expect(w.count).toBe(2);
    expect(w.air!.sort()).toEqual([await identity(link.id, U.viewer), await identity(link.id, U.named)].sort());
    for (const id of w.air!) expect(id).toMatch(/^air-[0-9a-f]{24}$/);
    expect(JSON.stringify(w)).not.toContain(U.viewer);
    // A second link gives the same viewer another identity.
    const other = await share(U.p1);
    expect(await identity(other.id, U.viewer)).not.toBe(await identity(link.id, U.viewer));
  });

  it('viewers and watching friends see who is on air, never the list of listeners', async () => {
    const link = await share(U.p0);
    await open(U.viewer, link.token);
    await onAir(U.p0, ROOM, true);
    const shared = await call<{ watchers: { on_air: number[]; air: string[] | null } }>(U.viewer, 'select public.shared_room($1) as r', [ROOM]);
    expect(shared.watchers.on_air).toEqual([0]);
    expect(shared.watchers.air).toBeNull();
    expect((await watchers(U.viewer))!.air).toBeNull();
    await db.query(`insert into public.room_spectators (room_id, user_id) values ($1, $2)`, [ROOM, U.friend]);
    const f = (await watchers(U.friend))!;
    expect(f.on_air).toEqual([0]);
    expect(f.air).toBeNull();
    expect(await watchers(U.stranger)).toBeNull();
  });

  it('a friend who also opened the link is let in by link too (though counted as a friend)', async () => {
    const link = await share(U.p0);
    await db.query(`insert into public.room_spectators (room_id, user_id) values ($1, $2)`, [ROOM, U.friend]);
    await open(U.friend, link.token);
    const w = (await watchers(U.p0))!;
    expect(w.count).toBe(0);
    expect(w.air).toEqual([await identity(link.id, U.friend)]);
  });

  it('the list follows the link: turned off, or a viewer gone quiet for 75 s, and they are out', async () => {
    const link = await share(U.p0);
    await open(U.viewer, link.token);
    await open(U.named, link.token);
    await db.query(`update public.room_share_viewers set seen_at = now() - interval '2 minutes' where user_id = $1`, [U.named]);
    expect((await watchers(U.p0))!.air).toEqual([await identity(link.id, U.viewer)]);
    await call(U.p2, 'select public.revoke_room_share_link($1) as r', [link.id]);
    expect((await watchers(U.p0))!.air).toEqual([]);
  });

  it('a rematch empties it', async () => {
    const link = await share(U.p0);
    await open(U.viewer, link.token);
    await db.query(`insert into public.games (id, room_id) values ('20000000-0000-4000-8000-0000000000ff', $1)`, [ROOM]);
    await db.query(`update public.rooms set current_game = '20000000-0000-4000-8000-0000000000ff' where id = $1`, [ROOM]);
    expect((await watchers(U.p0))!.air).toEqual([]);
    await db.query('update public.rooms set current_game = $2 where id = $1', [ROOM, G1]);
  });
});

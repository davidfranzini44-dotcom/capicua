// Live-match sharing: the access boundary, on a real Postgres (PGlite) running the real
// migrations — the watch and spectators migrations as they are, then the share migrations.
// Sessions: four seated players, a friend watching one of them, a guest session made just
// to watch (anonymous, no name), a signed-in viewer with a name, and a stranger.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import BASE from './sql/share_base.sql?raw';
import WATCH from '../supabase/migrations/20261001000100_watch.sql?raw';
import SPECTATORS from '../supabase/migrations/20261008000000_spectators.sql?raw';
import SHARE from '../supabase/migrations/20261011000000_live_share.sql?raw';
import VOICE from '../supabase/migrations/20261012000000_share_voice.sql?raw';
import VOICE_ON from '../supabase/migrations/20261012000100_voice_air_default_on.sql?raw';
import SPEC_SHARE from '../supabase/migrations/20261012000200_spectators_share.sql?raw';

const U = {
  p0: '00000000-0000-4000-8000-000000000000', p1: '00000000-0000-4000-8000-000000000001',
  p2: '00000000-0000-4000-8000-000000000002', p3: '00000000-0000-4000-8000-000000000003',
  friend: '00000000-0000-4000-8000-0000000000f0', viewer: '00000000-0000-4000-8000-0000000000a0',
  named: '00000000-0000-4000-8000-0000000000b0', stranger: '00000000-0000-4000-8000-0000000000c0',
  other: '00000000-0000-4000-8000-0000000000d0',
};
const ROOM = '10000000-0000-4000-8000-000000000001';
const OTHER_ROOM = '10000000-0000-4000-8000-000000000002';
const G1 = '20000000-0000-4000-8000-000000000001';
const G_OTHER = '20000000-0000-4000-8000-000000000002';

let db: PGlite;

/** Run as a signed-in user (Supabase's `authenticated` role with that JWT subject). */
function as<T>(uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}
const one = async <T = Record<string, unknown>>(tx: Transaction, q: string, p: unknown[] = []) => (await tx.query<T>(q, p)).rows[0];
const count = async (tx: Transaction, q: string, p: unknown[] = []) => (await tx.query(q, p)).rows.length;
const rpc = <T = Record<string, unknown>>(uid: string, fn: string, arg: unknown) =>
  as(uid, async (tx) => (await one<{ r: T }>(tx, `select public.${fn}($1) as r`, [arg])).r);
const fails = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toThrow(code); };
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

type Link = { id: string; token: string; expires_at: string; focus_seat: number };

beforeAll(async () => {
  db = new PGlite();
  for (const sql of [BASE, WATCH, SPECTATORS, SHARE, VOICE, VOICE_ON, SPEC_SHARE]) await db.exec(sql);

  const people: [string, string, boolean, boolean][] = [
    [U.p0, 'Robert', false, false], [U.p1, 'Yokasta', false, false], [U.p2, 'Wilfri', false, false], [U.p3, 'Kirsy', false, false],
    [U.friend, 'Papo Amigo', false, false], [U.viewer, 'Jugador', true, true], [U.named, 'Nadia', false, false],
    [U.stranger, 'Extraño', false, false], [U.other, 'Otro', false, false],
  ];
  for (const [id, name, anon, needsName] of people) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, anon]);
    await db.query(`insert into public.profiles (id, display_name, needs_name, ban_reason, friend_code) values ($1, $2, $3, 'motivo privado', 'ABC123')`, [id, name, needsName]);
  }
  await db.query(`insert into public.friendships values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'accepted')`, [U.p0, U.friend]);

  await db.query(`insert into public.rooms (id, code, phase, current_game, visibility) values ($1, 'SECRETO', 'playing', $2, 'private')`, [ROOM, G1]);
  await db.query(`insert into public.games (id, room_id, public_state) values ($1, $2, '{"handNo": 3, "scores": [42, 28]}')`, [G1, ROOM]);
  for (let s = 0; s < 4; s++) {
    await db.query('insert into public.room_seats (room_id, seat, user_id, name) values ($1, $2, $3, $4)', [ROOM, s, [U.p0, U.p1, U.p2, U.p3][s], ['Robert', 'Yokasta', 'Wilfri', 'Kirsy'][s]]);
    await db.query(`insert into public.game_hands values ($1, $2, $3, '[[6,6],[5,4]]')`, [G1, s, [U.p0, U.p1, U.p2, U.p3][s]]);
  }
  await db.query(`insert into public.game_private values ($1, '{"hands": "all of them"}')`, [G1]);
  await db.query(`insert into public.side_bets (room_id, game_id, user_id, kind, amount) values ($1, $2, $3, 'pollona', 500)`, [ROOM, G1, U.p0]);

  await db.query(`insert into public.rooms (id, code, phase, current_game) values ($1, 'OTRA', 'playing', $2)`, [OTHER_ROOM, G_OTHER]);
  await db.query(`insert into public.games (id, room_id) values ($1, $2)`, [G_OTHER, OTHER_ROOM]);
  await db.query(`insert into public.room_seats (room_id, seat, user_id, name) values ($1, 0, $2, 'Otro')`, [OTHER_ROOM, U.other]);
});

describe('making a link', () => {
  it('a seated player makes one for the current game; only its SHA-256 digest is stored', async () => {
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.focus_seat).toBe(0);
    const expires = Date.parse(link.expires_at) - Date.now();
    expect(expires).toBeGreaterThan(3.9 * 3600_000);
    expect(expires).toBeLessThanOrEqual(4 * 3600_000 + 5_000);
    const row = (await db.query<Record<string, unknown>>('select * from public.room_share_links where id = $1', [link.id])).rows[0];
    expect(hex(row.token_hash as Uint8Array)).toBe(await sha256(link.token));
    expect(row.game_id).toBe(G1);
    // The token itself isn't in any column.
    expect(JSON.stringify(row)).not.toContain(link.token);
  });

  it('two links never share a token', async () => {
    const a = await rpc<Link>(U.p1, 'create_room_share_link', ROOM);
    const b = await rpc<Link>(U.p1, 'create_room_share_link', ROOM);
    expect(a.token).not.toBe(b.token);
  });

  it('a stranger can neither make nor turn off a link', async () => {
    await fails(rpc(U.stranger, 'create_room_share_link', ROOM), 'not_seated');
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await fails(rpc(U.stranger, 'revoke_room_share_link', link.id), 'not_allowed');
    await fails(rpc(U.friend, 'revoke_room_share_link', link.id), 'not_allowed');
  });

  it('nobody reads the link tables directly, and the API role without a session runs nothing', async () => {
    await fails(as(U.p0, (tx) => tx.query('select * from public.room_share_links')), 'permission denied');
    await fails(as(U.p0, (tx) => tx.query('select * from public.room_share_viewers')), 'permission denied');
    await fails(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query('select public.create_room_share_link($1)', [ROOM]); }), 'permission denied');
    await fails(db.transaction(async (tx) => { await tx.exec('set local role anon'); await tx.query(`select public.watch_shared_match('x')`); }), 'permission denied');
  });

  it('players see the open links on their game (never the token); others see none', async () => {
    const list = await rpc<{ id: string; mine: boolean }[]>(U.p2, 'room_share_links_active', ROOM);
    expect(list.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toMatch(/token/);
    expect(list.every((l) => l.mine === false)).toBe(true);
    expect(await rpc(U.stranger, 'room_share_links_active', ROOM)).toEqual([]);
  });
});

describe('opening a link', () => {
  let link: Link;
  beforeAll(async () => { link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM); });

  it('refuses malformed and unknown tokens the same way', async () => {
    for (const bad of ['abc', "x'; drop table rooms; --", 'A'.repeat(43), '']) await fails(rpc(U.viewer, 'watch_shared_match', bad), 'link_invalid');
  });

  it('a guest session made to watch opens it: the game, the seats, the score — and is counted', async () => {
    const r = await rpc<Record<string, unknown>>(U.viewer, 'watch_shared_match', link.token);
    expect(r).toEqual({ room_id: ROOM, game_id: G1, focus_seat: 0, player: false });
    await as(U.viewer, async (tx) => {
      const g = await one<{ public_state: { scores: number[] } }>(tx, 'select public_state from public.games where id = $1', [G1]);
      expect(g.public_state.scores).toEqual([42, 28]);
      expect(await count(tx, 'select * from public.room_seats where room_id = $1', [ROOM])).toBe(4);
    });
    const shared = await rpc<{ room: Record<string, unknown>; game_id: string; players: unknown[]; watchers: { count: number } }>(U.viewer, 'shared_room', ROOM);
    expect(shared.game_id).toBe(G1);
    expect(shared.room).not.toHaveProperty('code');
    expect(JSON.stringify(shared)).not.toContain('SECRETO');
    expect(shared.players).toHaveLength(4);
    expect(shared.watchers.count).toBe(1);
  });

  it("…but never anyone's fichas, the private state, bets, the join code, other tables or private profile fields", async () => {
    await as(U.viewer, async (tx) => {
      expect(await count(tx, 'select * from public.game_hands where game_id = $1', [G1])).toBe(0);
      expect(await count(tx, 'select * from public.game_private')).toBe(0);
      expect(await count(tx, 'select * from public.side_bets')).toBe(0);
      expect(await count(tx, 'select code from public.rooms where id = $1', [ROOM])).toBe(0);
      expect(await count(tx, 'select * from public.rooms')).toBe(0);
      expect(await count(tx, 'select * from public.games where id = $1', [G_OTHER])).toBe(0);
      expect(await count(tx, 'select * from public.room_seats where room_id = $1', [OTHER_ROOM])).toBe(0);
      expect(await count(tx, 'select * from public.room_spectators')).toBe(0);
      // A guest session that hasn't picked a name reads only its own profile.
      expect(await count(tx, 'select ban_reason, chips from public.profiles where id <> $1', [U.viewer])).toBe(0);
      expect(await count(tx, 'select * from public.profiles where id = $1', [U.viewer])).toBe(1);
    });
    await fails(rpc(U.viewer, 'shared_room', OTHER_ROOM), 'link_gone');
  });

  it('a player opening their own table\'s link is sent to the table, not counted', async () => {
    expect(await rpc(U.p3, 'watch_shared_match', link.token)).toMatchObject({ player: true });
  });

  it('players see how many watch by link, and the names of viewers who have one', async () => {
    await rpc(U.named, 'watch_shared_match', link.token);
    const w = await rpc<{ count: number; names: string[] }>(U.p1, 'room_share_watchers', ROOM);
    expect(w.count).toBe(2);
    expect(w.names).toEqual(['Nadia']);
    expect(JSON.stringify(w)).not.toContain(U.viewer);
    expect(await rpc(U.stranger, 'room_share_watchers', ROOM)).toBeNull();
    // A signed-in viewer with a name keeps seeing profiles as any player does.
    await as(U.named, async (tx) => expect(await count(tx, 'select display_name from public.profiles')).toBeGreaterThan(1));
  });

  it('link viewers read spectator messages; only those with a name may write', async () => {
    await fails(rpc2(U.viewer, 'hola'), 'name_required');
    await as(U.named, (tx) => tx.query('select public.spectator_say($1, $2)', [ROOM, '¡Qué jugada!']));
    await fails(rpc2(U.p1, 'pasa la ficha'), 'not_watching');
    await fails(rpc2(U.stranger, 'hola'), 'not_watching');
    await as(U.viewer, async (tx) => expect(await count(tx, 'select * from public.room_messages where room_id = $1', [ROOM])).toBe(1));
  });

  it('leaving stops the count', async () => {
    await as(U.named, (tx) => tx.query('select public.leave_shared_match($1)', [ROOM]));
    expect((await rpc<{ count: number }>(U.p1, 'room_share_watchers', ROOM)).count).toBe(1);
  });
});

const rpc2 = (uid: string, text: string) => as(uid, (tx) => tx.query('select public.spectator_say($1, $2)', [ROOM, text]));

describe('turning off, expiring, rematch, end of match', () => {
  // Each case starts with no live links, so access can only come from the one it makes.
  beforeEach(async () => { await db.query('update public.room_share_links set revoked_at = now() where revoked_at is null'); });

  it('another seated player turns a link off: access ends at once; turning it off again is fine', async () => {
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await rpc(U.viewer, 'watch_shared_match', link.token);
    await rpc(U.p2, 'revoke_room_share_link', link.id);
    await rpc(U.p2, 'revoke_room_share_link', link.id);
    await as(U.viewer, async (tx) => {
      expect(await count(tx, 'select * from public.games where id = $1', [G1])).toBe(0);
      expect(await count(tx, 'select * from public.room_seats where room_id = $1', [ROOM])).toBe(0);
    });
    await fails(rpc(U.viewer, 'shared_room', ROOM), 'link_gone');
    await fails(rpc(U.viewer, 'watch_shared_match', link.token), 'link_gone');
  });

  it('an expired link opens nothing', async () => {
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await rpc(U.viewer, 'watch_shared_match', link.token);
    await db.query(`update public.room_share_links set expires_at = now() - interval '1 minute' where id = $1`, [link.id]);
    await as(U.viewer, async (tx) => expect(await count(tx, 'select * from public.games where id = $1', [G1])).toBe(0));
    await fails(rpc(U.viewer, 'watch_shared_match', link.token), 'link_gone');
  });

  it('friend-watching is its own grant: a link on top of it, then off, leaves it as it was', async () => {
    const room = await as(U.friend, async (tx) => (await one<{ r: string }>(tx, 'select public.watch_friend($1) as r', [U.p0])).r);
    expect(room).toBe(ROOM);
    const before = await one<{ expires_at: string }>(db as unknown as Transaction, 'select expires_at from public.room_spectators where user_id = $1', [U.friend]);
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await rpc(U.friend, 'watch_shared_match', link.token);
    await rpc(U.p0, 'revoke_room_share_link', link.id);
    const after = await one<{ expires_at: string }>(db as unknown as Transaction, 'select expires_at from public.room_spectators where user_id = $1', [U.friend]);
    expect(after.expires_at).toEqual(before.expires_at);
    await as(U.friend, async (tx) => {
      expect(await count(tx, 'select * from public.games where id = $1', [G1])).toBe(1);
      expect(await count(tx, 'select * from public.rooms where id = $1', [ROOM])).toBe(1);
      expect(await count(tx, 'select * from public.game_hands')).toBe(0);
    });
    await as(U.friend, (tx) => tx.query('select public.stop_watching($1)', [ROOM]));
  });

  it("a link can't follow the players into a rematch", async () => {
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await rpc(U.viewer, 'watch_shared_match', link.token);
    const G2 = '20000000-0000-4000-8000-0000000000a2';
    await db.query('insert into public.games (id, room_id) values ($1, $2)', [G2, ROOM]);
    await db.query('update public.rooms set current_game = $1 where id = $2', [G2, ROOM]);
    await as(U.viewer, async (tx) => {
      expect(await count(tx, 'select * from public.games where id = $1', [G2])).toBe(0);
      expect(await count(tx, 'select * from public.games where id = $1', [G1])).toBe(0);
    });
    await fails(rpc(U.viewer, 'watch_shared_match', link.token), 'link_gone');
    // The rematch needs a link of its own.
    const again = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    expect((await rpc<{ game_id: string }>(U.viewer, 'watch_shared_match', again.token)).game_id).toBe(G2);
  });

  it('the final result stays up 2 minutes after the match ends, then the link closes', async () => {
    const link = await rpc<Link>(U.p1, 'create_room_share_link', ROOM);
    await rpc(U.viewer, 'watch_shared_match', link.token);
    await db.query(`update public.games set finished_at = now() - interval '30 seconds' where id = (select current_game from public.rooms where id = $1)`, [ROOM]);
    const shared = await rpc<{ ends_at: string }>(U.viewer, 'shared_room', ROOM);
    expect(Date.parse(shared.ends_at) - Date.now()).toBeLessThanOrEqual(90_000 + 5_000);
    await fails(rpc(U.p1, 'create_room_share_link', ROOM), 'no_live_game');
    await db.query(`update public.games set finished_at = now() - interval '3 minutes' where id = (select current_game from public.rooms where id = $1)`, [ROOM]);
    await fails(rpc(U.viewer, 'shared_room', ROOM), 'link_gone');
    await as(U.viewer, async (tx) => expect(await count(tx, 'select * from public.room_seats where room_id = $1', [ROOM])).toBe(0));
  });

  it('a table keeps at most 10 live links', async () => {
    const G3 = '20000000-0000-4000-8000-0000000000a3';
    await db.query('insert into public.games (id, room_id) values ($1, $2)', [G3, ROOM]);
    await db.query('update public.rooms set current_game = $1 where id = $2', [G3, ROOM]);
    for (let i = 0; i < 10; i++) await rpc(U.p0, 'create_room_share_link', ROOM);
    await fails(rpc(U.p0, 'create_room_share_link', ROOM), 'too_many_links');
  });
});

describe('spectators share too', () => {
  const G4 = '20000000-0000-4000-8000-0000000000a4';
  beforeAll(async () => {
    await db.query('insert into public.games (id, room_id) values ($1, $2)', [G4, ROOM]);
    await db.query('update public.rooms set current_game = $1 where id = $2', [G4, ROOM]);
    await db.query(`insert into public.room_spectators (room_id, user_id) values ($1, $2)
      on conflict (room_id, user_id) do update set expires_at = now() + interval '1 hour'`, [ROOM, U.friend]);
  });

  it("a friend watching makes a link, shown from their friend's seat, and can turn it off", async () => {
    const link = await rpc<Link>(U.friend, 'create_room_share_link', ROOM);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.focus_seat).toBe(0); // Robert (p0) is the friend
    expect(await rpc(U.named, 'watch_shared_match', link.token)).toMatchObject({ room_id: ROOM, focus_seat: 0, player: false });
    // The players see it among the open links and can turn it off; so can the friend who made it.
    expect((await rpc<{ id: string }[]>(U.p2, 'room_share_links_active', ROOM)).some((l) => l.id === link.id)).toBe(true);
    await rpc(U.friend, 'revoke_room_share_link', link.id);
    await fails(rpc(U.named, 'shared_room', ROOM), 'link_gone');
  });

  // (Since 20261013000000 anyone watching may share: see tournamentHistory.rls.test.ts.)
  it('a spectator whose watch ran out makes none', async () => {
    await db.query(`update public.room_spectators set expires_at = now() - interval '1 minute' where user_id = $1`, [U.friend]);
    await fails(rpc(U.friend, 'create_room_share_link', ROOM), 'not_seated');
  });

  it('someone watching by link passes on the link they have, but makes no new one', async () => {
    const link = await rpc<Link>(U.p0, 'create_room_share_link', ROOM);
    await rpc(U.viewer, 'watch_shared_match', link.token);
    await fails(rpc(U.viewer, 'create_room_share_link', ROOM), 'not_seated');
  });
});

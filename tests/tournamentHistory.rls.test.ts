// Tournaments after the fact and from the stands, on a real Postgres (PGlite) running the real
// migrations: each player's history, members watching any match, and watchers sharing it.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import BASE from './sql/share_base.sql?raw';
import WATCH from '../supabase/migrations/20261001000100_watch.sql?raw';
import SPECTATORS from '../supabase/migrations/20261008000000_spectators.sql?raw';
import SHARE from '../supabase/migrations/20261011000000_live_share.sql?raw';
import HISTORY from '../supabase/migrations/20261013000000_tournament_history_watch.sql?raw';

// Just the tournament tables these functions read (the real ones carry more columns).
const TOURNAMENTS = `
create table public.tournaments (
  id uuid primary key, code text not null, name text not null, host uuid not null references public.profiles (id),
  mode text not null, size int not null, rounds int, pot bigint not null default 0, champion uuid,
  phase text not null default 'lobby', finished_at timestamptz);
create table public.tournament_entries (
  id uuid primary key, tournament_id uuid not null references public.tournaments (id),
  player1 uuid not null references public.profiles (id), player2 uuid references public.profiles (id),
  eliminated_round int, placement int);
alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;`;

const U = {
  ana: '00000000-0000-4000-8000-000000000001', beto: '00000000-0000-4000-8000-000000000002',
  caro: '00000000-0000-4000-8000-000000000003', dani: '00000000-0000-4000-8000-000000000004',
  host: '00000000-0000-4000-8000-000000000005', outsider: '00000000-0000-4000-8000-000000000006',
  guest: '00000000-0000-4000-8000-000000000007',
};
const T1 = '30000000-0000-4000-8000-000000000001'; // finished: Ana won, Beto runner-up, Caro & Dani semis
const T2 = '30000000-0000-4000-8000-000000000002'; // still being played: its final is on
const E = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const FINAL = '10000000-0000-4000-8000-000000000001';
const GAME = '20000000-0000-4000-8000-000000000001';
const CASUAL = '10000000-0000-4000-8000-000000000002';

let db: PGlite;
function as<T>(uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}
const call = <T = unknown>(uid: string, sql: string, params: unknown[] = []) =>
  as(uid, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0].r);
const fails = async (p: Promise<unknown>, code: string) => { await expect(p).rejects.toThrow(code); };
type Row = { name: string; placement: number | null; eliminated_round: number | null; champion: string | null; partner: string | null; entries: number };
const history = (who: string, of: string) => call<Row[]>(who, 'select public.tournament_history($1) as r', [of]);
const watch = (who: string, room: string) => call<{ room_id: string; focus: string; name: string }>(who, 'select public.watch_tournament_match($1) as r', [room]);

beforeAll(async () => {
  db = new PGlite();
  for (const sql of [BASE, WATCH, SPECTATORS, TOURNAMENTS, SHARE, HISTORY]) await db.exec(sql);
  const people: [string, string, boolean][] = [
    [U.ana, 'Ana', false], [U.beto, 'Beto', false], [U.caro, 'Caro', false], [U.dani, 'Dani', false],
    [U.host, 'Anfitrión', false], [U.outsider, 'Otro', false], [U.guest, 'Jugador', true],
  ];
  for (const [id, name, guest] of people) {
    await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [id, guest]);
    await db.query('insert into public.profiles (id, display_name, needs_name) values ($1, $2, $3)', [id, name, guest]);
  }
  await db.query(`insert into public.tournaments (id, code, name, host, mode, size, rounds, pot, phase, finished_at)
    values ($1, 'COPA1', 'Copa del Viernes', $2, '1v1', 4, 2, 4000, 'finished', now() - interval '1 day'),
           ($3, 'COPA2', 'Copa del Sábado', $2, '1v1', 4, 2, 0, 'playing', null)`, [T1, U.host, T2]);
  const entries: [string, string, string, number | null, number | null][] = [
    [E(1), T1, U.ana, null, 1], [E(2), T1, U.beto, 2, 2], [E(3), T1, U.caro, 1, 3], [E(4), T1, U.dani, 1, 3],
    [E(5), T2, U.ana, null, null], [E(6), T2, U.caro, null, null], [E(7), T2, U.dani, 1, 3], [E(8), T2, U.beto, 1, 3],
  ];
  for (const [id, t, p, out, place] of entries) {
    await db.query('insert into public.tournament_entries (id, tournament_id, player1, eliminated_round, placement) values ($1, $2, $3, $4, $5)', [id, t, p, out, place]);
  }
  await db.query('update public.tournaments set champion = $1 where id = $2', [E(1), T1]);
  // T2's final: Ana v Caro, being played.
  await db.query(`insert into public.rooms (id, code, kind, phase, current_game, tournament_id) values ($1, 'FINAL', 'tournament', 'playing', $2, $3)`, [FINAL, GAME, T2]);
  await db.query('insert into public.games (id, room_id) values ($1, $2)', [GAME, FINAL]);
  await db.query(`insert into public.room_seats (room_id, seat, user_id, name) values ($1, 0, $2, 'Ana'), ($1, 1, $3, 'Caro')`, [FINAL, U.ana, U.caro]);
  await db.query(`insert into public.rooms (id, code, kind, phase) values ($1, 'MESA', 'custom', 'playing')`, [CASUAL]);
  await db.query(`insert into public.room_seats (room_id, seat, user_id, name) values ($1, 0, $2, 'Beto')`, [CASUAL, U.beto]);
});

describe('tournament history', () => {
  it('every player keeps it, with where they finished and who won', async () => {
    const ana = await history(U.ana, U.ana);
    expect(ana).toHaveLength(1); // the tournament still being played is not history yet
    expect(ana[0]).toMatchObject({ name: 'Copa del Viernes', placement: 1, champion: 'Ana', entries: 4 });
    expect((await history(U.beto, U.beto))[0]).toMatchObject({ placement: 2, eliminated_round: 2, champion: 'Ana' });
    expect((await history(U.dani, U.dani))[0]).toMatchObject({ placement: 3, eliminated_round: 1 });
  });

  it("other players see it on the profile card; a guest without a name sees only their own; nobody's else is listed", async () => {
    expect((await history(U.outsider, U.ana))[0]).toMatchObject({ placement: 1 });
    expect(await history(U.guest, U.ana)).toEqual([]);
    expect(await history(U.guest, U.guest)).toEqual([]);
    expect(await history(U.outsider, U.outsider)).toEqual([]);
    expect(await history(U.host, U.host)).toEqual([]); // hosting isn't playing
  });
});

describe('watching a tournament match', () => {
  it('every member — knocked out, still in, or the host — watches any match, from its first player', async () => {
    for (const who of [U.dani, U.beto, U.host]) {
      expect(await watch(who, FINAL)).toEqual({ room_id: FINAL, focus: U.ana, name: 'Ana' });
    }
    // …through the spectators' grant: the game, the seats, and the room list them as watching.
    await as(U.dani, async (tx) => {
      expect((await tx.query('select id from public.games where id = $1', [GAME])).rows).toHaveLength(1);
      expect((await tx.query('select seat from public.room_seats where room_id = $1', [FINAL])).rows).toHaveLength(2);
    });
    expect((await db.query('select user_id from public.room_spectators where room_id = $1', [FINAL])).rows).toHaveLength(3);
  });

  it('not for outsiders, not for its own players, not for tables outside a tournament', async () => {
    await fails(watch(U.outsider, FINAL), 'not_in_tournament');
    await fails(watch(U.ana, FINAL), 'already_in_room');
    await fails(watch(U.dani, CASUAL), 'not_a_tournament_match');
  });
});

describe('whoever watches can share', () => {
  it('a member watching makes a link, shown from the first player', async () => {
    const link = await call<{ token: string; focus_seat: number }>(U.dani, 'select public.create_room_share_link($1) as r', [FINAL]);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.focus_seat).toBe(0);
  });

  it("a friend watching shares from their friend's seat", async () => {
    await db.query(`insert into public.friendships values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'accepted')`, [U.beto, U.caro]);
    const link = await call<{ focus_seat: number }>(U.beto, 'select public.create_room_share_link($1) as r', [FINAL]);
    expect(link.focus_seat).toBe(1);
  });

  it('nobody who is not watching (or playing) makes one', async () => {
    await fails(call(U.outsider, 'select public.create_room_share_link($1) as r', [FINAL]), 'not_seated');
  });
});

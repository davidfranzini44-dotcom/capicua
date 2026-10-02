// Game actions for the `game` edge function (index.ts handles HTTP + auth).
// Rules live in ../_shared — the same code the browser runs.
//
// Room lifecycle:
//   public:  queue_join → (matched) ready | countdown → playing → finished
//   custom:  create_custom → lobby → (host start) countdown → playing → finished → rematch → lobby
// Clients call `tick_room` when a phase deadline passes and `tick` when the
// game's auto_delay_ms says the server should act (bots, timeouts, next hand).

import type postgres from 'npm:postgres@3.4.5';
import { AccessToken } from 'npm:livekit-server-sdk@2';
import { chooseMove } from '../_shared/bot.ts';
import {
  applyMove, forcedMove, isArcade, isPollona, newGame, nextHand, seatsOf, sideOf, standings,
  type GameState, type Mode, type Move, type Rules, type Ruleset, type Seat,
} from '../_shared/domino.ts';
import {
  arcadeAllowed, autoAction, autoDelay, botsAllowed, CHEST_SLOTS, chestReward, CHESTS, CHIPS, customMinHumans, customRules, effectiveStake, hasHumanOpponents, rollChest, rushCost, gameXp, LEAVER_XP, levelFromXp, LOBBY, matchRules, MAX_STRIKES,
  MIN_PEOPLE_FOR_BOT_FILL, minHumans, MODES, needsReadyCheck, payouts, publicState, rivalBonus, roomCode, rulesetOf, RULESETS, salaFor, seatsNeeded, SIDE_BET_KINDS,
  sideBetLimit, sideBetMultiplier, sideBetWon, TURN_SECONDS, validateCustom, voiceRoomFor,
  type ChestKind, type SeatInfo, type SideBetKind,
} from '../_shared/table.ts';
import {
  afterFeeders, bracketSize, checkInOpen, drawFirstRound, minEntries, noShowOutcome, pairPartners, placementFor, playersPerEntry, prizes, roundCount, TOURNAMENT,
  tournamentRules, validateTournament, validateTournamentEdit, type PartnerMatching, type Seeding, type TournamentEdit, type TournamentMode,
} from '../_shared/tournament.ts';
import { canUse, chipPrice, lookById } from '../_shared/cosmetics.ts';
import { pickWeighted, sponsorMatches, validateSponsor } from '../_shared/sponsors.ts';
import { networkOf, pairKey, pickGroup, shuffled } from '../_shared/fairplay.ts';
import { db } from './db.ts';
import { createCheckout, ShopError } from './purchases.ts';

export let sql: postgres.Sql;
/** index.ts awaits this before running any action. */
export async function ready() {
  if ((sql as postgres.Sql | undefined) !== undefined) return;
  sql = await db();
  // The tournament clock (pg_cron) calls this function back: tell it where. Its gateway
  // wants a JWT: the anon key is one on older projects; on the new API keys it's an
  // sb_publishable_… key and the clock uses the 'anon_jwt' row set by hand instead.
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (url) {
    const rows = [{ key: 'game_url', value: `${url}/functions/v1/game` }, ...(anon.startsWith('eyJ') ? [{ key: 'anon_key', value: anon }] : [])];
    await sql`
      insert into app_secrets ${sql(rows)}
      on conflict (key) do update set value = excluded.value where app_secrets.value <> excluded.value`
      .catch((e) => console.error('remember clock target', e));
  }
}
type Tx = postgres.TransactionSql;

const BOT_NAMES = ['Chelo', 'Yuly', 'Papo', 'Nando', 'Kirsy', 'Toño'];
/** A half-full public table fills its empty chairs with bots after this long in the queue (only where bots are allowed). */
const BOT_FILL_MS = 40_000;
/** How many of the longest-waiting players are looked at when picking a table. */
const MATCH_POOL = 40;

export class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

// ---------- rows ----------

interface RoomDb {
  id: string; code: string; kind: 'public' | 'custom' | 'tournament'; mode: Mode; rules: Rules; stake: number;
  turn_seconds: number; visibility: 'public' | 'private'; host: string | null;
  phase: 'lobby' | 'ready' | 'countdown' | 'playing' | 'finished'; phase_due: boolean; current_game: string | null;
  tournament_id: string | null;
}
interface TournamentDb {
  id: string; code: string; name: string; host: string; mode: TournamentMode; size: number; buy_in: number;
  rules: Rules; turn_seconds: number; phase: 'lobby' | 'playing' | 'finished' | 'cancelled'; rounds: number | null; pot: number;
  /** Scheduled start (null: an older tournament the host starts by hand). */
  starts_at: Date | null;
  /** Check-in reminders sent: 1 = check-in open, 2 = last call. */
  reminded: number;
  /** How the first round is matched (migration 20261014000000). */
  seeding: Seeding;
  /** How solo 2v2 entrants receive partners (migration 20261019000000). */
  partner_matching: PartnerMatching;
  /** Migration 20261016000000: public = listed for anyone to join; official = made by an admin, who doesn't play. */
  visibility: 'private' | 'public';
  official: boolean;
  featured: boolean;
  /** The house prize already in the pot (official tournaments). */
  prize: number;
  description: string | null;
  announced_at: Date | null;
}
interface EntryDb { id: string; player1: string; player2: string | null }
interface MatchDb {
  id: string; tournament_id: string; round: number; slot: number; entry_a: string | null; entry_b: string | null;
  room_id: string | null; status: 'waiting' | 'ready' | 'playing' | 'done';
}
type MatchResult = 'played' | 'bye' | 'forfeit' | 'no_show';
interface SeatRow {
  seat: number; user_id: string | null; is_bot: boolean; name: string; level: number;
  ready: boolean; away: boolean; left_game: boolean; strikes: number;
  /** Walked out of a game in progress to join another table: the server plays the seat, for good. */
  forfeited?: boolean;
}
interface PairStats {
  u1: string; u2: string; name1: string; name2: string; games: number; public_games: number; partners: number;
  partner_wins: number; wins1: number; wins2: number; staked: string | number; friends: boolean; same_net: boolean;
}
interface GameDb {
  id: string; room_id: string; stake: number; pot: number; turn_ms: number; settled: boolean; state: GameState; last_ms: number;
  version: number; auto_delay_ms: number | null;
}

const toSeatInfo = (r: SeatRow): SeatInfo => ({ seat: r.seat as Seat, userId: r.user_id, name: r.name, isBot: r.is_bot, away: r.away });
const humansOf = (seats: SeatRow[]) => seats.filter((s) => !s.is_bot && s.user_id);
const later = (ms: number) => sql`now() + ${ms} * interval '1 millisecond'`;
const humansNeeded = (room: RoomDb) => room.kind === 'custom' ? customMinHumans(room.mode, room.stake) : minHumans(room.mode, room.stake);
const enoughHumans = (room: RoomDb, seats: SeatRow[]) =>
  humansOf(seats).length >= humansNeeded(room)
  && (room.kind !== 'custom' || room.stake === 0 || room.mode !== '2v2' || hasHumanOpponents(room.mode, seats.map(toSeatInfo)));

async function lockRoom(tx: Tx, roomId: string) {
  const [room] = await tx<RoomDb[]>`
    select *, coalesce(phase_ends_at <= now(), false) as phase_due from rooms where id = ${roomId} for update`;
  if (!room) throw new HttpError(404, 'room_not_found');
  const seats = await tx<SeatRow[]>`select * from room_seats where room_id = ${room.id} order by seat`;
  return { room, seats };
}

function mySeat(seats: SeatRow[], uid: string) {
  const s = seats.find((x) => x.user_id === uid);
  if (!s) throw new HttpError(403, 'not_in_room');
  return s;
}

async function me(tx: Tx, uid: string) {
  const [p] = await tx`select * from profiles where id = ${uid} for update`;
  if (!p) throw new HttpError(404, 'no_profile');
  return { ...p, chips: Number(p.chips), level: levelFromXp(p.xp) } as {
    id: string; display_name: string; chips: number; xp: number; level: number;
    declines: number; declines_since: Date | null; queue_blocked_until: Date | null;
  };
}

/**
 * Guests (anonymous sign-ins) only play free tables — chips need a real
 * account. Read from auth.users each time so linking Google unlocks it at once.
 */
async function isGuest(tx: Tx, uid: string): Promise<boolean> {
  const [u] = await tx`select coalesce(is_anonymous, false) as guest from auth.users where id = ${uid}`;
  return !!u?.guest;
}

async function noGuests(tx: Tx, uid: string) {
  if (await isGuest(tx, uid)) throw new HttpError(403, 'guest_no_bets');
}

async function notBanned(tx: Tx, uid: string) {
  const [b] = await tx`select banned_until > now() as banned from profiles where id = ${uid}`;
  if (b?.banned) throw new HttpError(403, 'banned');
}

/** Admins are listed by email in `admins`; guests never count. */
async function isAdmin(tx: Tx | postgres.Sql, uid: string): Promise<boolean> {
  const [a] = await tx`
    select exists (
      select 1 from admins a join auth.users u on lower(u.email) = lower(a.email)
      where u.id = ${uid} and not coalesce(u.is_anonymous, false)
    ) as ok`;
  return !!a?.ok;
}

async function adminOnly(uid: string) {
  if (!(await isAdmin(sql, uid))) throw new HttpError(403, 'admin_only');
}

let netPepper: string | undefined;

/**
 * Note which network a player is playing from — hashed, never the address —
 * so chip tables keep people on the same home Wi-Fi apart.
 */
export async function recordNetwork(uid: string, ip: string | null) {
  const network = networkOf(ip);
  if (!network) return;
  netPepper ??= (await sql`select value from app_secrets where key = 'net_pepper'`)[0]?.value ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${netPepper}|${network}`));
  const net = [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await sql`
    insert into user_networks (user_id, net) values (${uid}, ${net})
    on conflict (user_id, net) do update set last_seen = now(), hits = user_networks.hits + 1
      where user_networks.last_seen < now() - interval '10 minutes'`;
}

/**
 * The table this player belongs at right now, if any. A game in progress
 * counts even if they walked out — their stake is in it and the server is
 * keeping their chair warm until they come back — unless they forfeited it
 * to join another table.
 */
async function activeRoomOf(tx: Tx, uid: string): Promise<string | null> {
  const [r] = await tx`
    select r.id from rooms r join room_seats s on s.room_id = r.id
    where s.user_id = ${uid} and not s.forfeited
      and (r.phase = 'playing' or (r.phase in ('lobby', 'ready', 'countdown') and not s.left_game))
    order by r.created_at desc limit 1`;
  return r?.id ?? null;
}

/**
 * Leave a table to go to another one (accepting an invite). A game in progress
 * is forfeited: the server plays the seat to the end (stake stays in the pot,
 * leaver XP applies) and the player can't take it back. Anywhere else it's the
 * same as leaving, without a decline strike.
 */
async function vacateFor(tx: Tx, roomId: string, uid: string) {
  const { room, seats } = await lockRoom(tx, roomId);
  const mine = mySeat(seats, uid);
  if (room.phase === 'playing') {
    await tx`update room_seats set away = true, left_game = true, forfeited = true where room_id = ${room.id} and seat = ${mine.seat}`;
    mine.away = true;
    await refreshDelay(tx, room, seats);
    return;
  }
  if (room.kind === 'public' && (room.phase === 'ready' || room.phase === 'countdown')) {
    await breakUpTable(tx, room, seats, [], [uid]);
    return;
  }
  if (room.kind === 'tournament') {
    // The match keeps its bracket: not ready, and free to sit elsewhere until they come back.
    await tx`update room_seats set ready = false, left_game = true where room_id = ${room.id} and seat = ${mine.seat}`;
    return;
  }
  await leaveCustom(tx, room, seats, uid);
}

/** Leave a custom table outside a game: side bets back, host passes on, an empty table closes. */
async function leaveCustom(tx: Tx, room: RoomDb, seats: SeatRow[], uid: string) {
  const mine = mySeat(seats, uid);
  await refundSideBets(tx, room.id, uid);
  await tx`delete from room_seats where room_id = ${room.id} and seat = ${mine.seat}`;
  const others = humansOf(seats).filter((s) => s.user_id !== uid);
  if (others.length === 0) {
    await tx`delete from rooms where id = ${room.id}`;
  } else {
    const host = room.host === uid ? others[0].user_id : room.host;
    // A custom countdown in progress stops if someone walks away.
    await tx`
      update rooms set host = ${host}, updated_at = now(),
        phase = case when phase = 'countdown' then 'lobby' else phase end,
        phase_ends_at = case when phase = 'countdown' then null else phase_ends_at end
      where id = ${room.id}`;
    if (host !== room.host) await tx`update room_seats set ready = true where room_id = ${room.id} and user_id = ${host}`;
  }
}

async function insertRoom(tx: Tx, f: {
  kind: RoomDb['kind']; mode: Mode; rules: Rules; stake: number; turnSeconds: number; visibility: 'public' | 'private';
  host: string | null; phase: RoomDb['phase']; phaseMs: number | null; tournamentId?: string;
}) {
  for (let i = 0; i < 8; i++) {
    const [room] = await tx`
      insert into rooms (code, kind, mode, rules, stake, turn_seconds, visibility, host, phase, phase_ends_at, tournament_id)
      values (${roomCode()}, ${f.kind}, ${f.mode}, ${tx.json(f.rules as never)}, ${f.stake}, ${f.turnSeconds},
              ${f.visibility}, ${f.host}, ${f.phase}, ${f.phaseMs === null ? null : later(f.phaseMs)}, ${f.tournamentId ?? null})
      on conflict (code) do nothing returning id, code, phase_ends_at`;
    if (room) return room as { id: string; code: string; phase_ends_at: Date | null };
  }
  throw new HttpError(503, 'no_code_available');
}

async function refundSideBets(tx: Tx, roomId: string, uid?: string) {
  const bets = await tx`
    update side_bets set status = 'refunded' where room_id = ${roomId} and status = 'open'
    ${uid ? tx`and user_id = ${uid}` : tx``} returning user_id, amount`;
  for (const b of bets) {
    await tx`update profiles set chips = chips + ${b.amount} where id = ${b.user_id}`;
    await tx`insert into chip_ledger (user_id, delta, reason) values (${b.user_id}, ${b.amount}, 'refund')`;
  }
}

// ---------- matchmaking ----------

/**
 * Pairs among these queued players who must not share a chip table: friends
 * (or a pending request) and players seen on the same home network lately.
 */
async function knownPairs(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (ids.length < 2) return new Set();
  const rows = await tx`
    select a.user_id as a, b.user_id as b
    from queue a join queue b on a.user_id < b.user_id
    where a.user_id in ${tx(ids)} and b.user_id in ${tx(ids)}
      and (
        exists (select 1 from friendships f where f.user_a = least(a.user_id, b.user_id) and f.user_b = greatest(a.user_id, b.user_id))
        or same_network(a.user_id, b.user_id)
      )`;
  return new Set(rows.map((r) => pairKey(r.a, r.b)));
}

/** Try to seat a full table (or a bot-filled one after a long wait) from the queue. Arcade and Traditional never mix. */
async function tryMatch(tx: Tx, stake: number, mode: Mode, ruleset: Ruleset): Promise<string | null> {
  const need = seatsNeeded(mode);
  const pool = await tx`
    select q.*, p.display_name, extract(epoch from now() - q.joined_at) * 1000 as waited_ms
    from queue q join profiles p on p.id = q.user_id
    where q.stake = ${stake} and q.mode = ${mode} and q.ruleset = ${ruleset} and (p.banned_until is null or p.banned_until <= now())
    order by q.joined_at for update of q skip locked limit ${MATCH_POOL}`;
  // Chip tables never seat people who know each other: they could pass each other their tiles.
  const known = stake > 0 ? await knownPairs(tx, pool.map((r) => r.user_id)) : new Set<string>();
  const rows = pickGroup(pool, need, (a, b) => known.has(pairKey(a.user_id, b.user_id)));
  const canFill = botsAllowed(mode, stake)
    && rows.length >= Math.max(MIN_PEOPLE_FOR_BOT_FILL, minHumans(mode, stake))
    && Math.max(0, ...rows.map((r) => Number(r.waited_ms))) >= BOT_FILL_MS;
  if (rows.length < need && !canFill) return null;

  // Shuffle so people who queue together don't land in predictable seats.
  const humans = shuffled(rows);
  const levels = humans.map((h) => h.level as number);
  const ready = needsReadyCheck(levels);
  const room = await insertRoom(tx, {
    kind: 'public', mode, rules: matchRules(mode, ruleset), stake, turnSeconds: ruleset === 'arcade' ? TURN_SECONDS.arcade : TURN_SECONDS.public,
    visibility: 'private', host: null, phase: ready ? 'ready' : 'countdown',
    phaseMs: ready ? LOBBY.readyMs : LOBBY.countdownMs,
  });
  // Humans take seats 0,1,2… so the first two always sit on different sides.
  const botLevel = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
  const names = BOT_NAMES.filter((n) => !humans.some((h) => h.display_name === n));
  for (const seat of seatsOf(mode)) {
    const h = humans[seat];
    if (h) await tx`insert into room_seats (room_id, seat, user_id, name, level) values (${room.id}, ${seat}, ${h.user_id}, ${h.display_name}, ${h.level})`;
    else await tx`insert into room_seats (room_id, seat, is_bot, name, level, ready) values (${room.id}, ${seat}, true, ${names.shift()!}, ${botLevel}, true)`;
  }
  await tx`delete from queue where user_id in ${tx(humans.map((h) => h.user_id))}`;
  return room.id;
}

/**
 * Someone said no (or didn't answer) before the game started. The table
 * breaks up: side bets come back, everyone else goes to the front of the
 * queue, and repeat decliners sit out for a few minutes.
 */
async function breakUpTable(tx: Tx, room: RoomDb, seats: SeatRow[], decliners: string[], leavers: string[] = []) {
  const now = Date.now();
  for (const uid of decliners) {
    const p = await me(tx, uid);
    const fresh = !p.declines_since || now - new Date(p.declines_since).getTime() > LOBBY.declineWindowMin * 60_000;
    const count = (fresh ? 0 : p.declines) + 1;
    if (count >= LOBBY.declineLimit) {
      await tx`update profiles set declines = 0, declines_since = null, queue_blocked_until = ${later(LOBBY.declineCooldownMin * 60_000)} where id = ${uid}`;
    } else {
      await tx`update profiles set declines = ${count}, declines_since = ${fresh ? sql`now()` : sql`declines_since`} where id = ${uid}`;
    }
  }
  await refundSideBets(tx, room.id);
  for (const s of humansOf(seats)) {
    if (decliners.includes(s.user_id!) || leavers.includes(s.user_id!)) continue;
    await tx`
      insert into queue (user_id, stake, mode, level, ruleset, joined_at)
      values (${s.user_id}, ${room.stake}, ${room.mode}, ${s.level}, ${rulesetOf(room.rules)}, now() - interval '10 minutes')
      on conflict (user_id) do nothing`;
  }
  await tx`delete from rooms where id = ${room.id}`;
}

// ---------- games ----------

async function startGame(tx: Tx, room: RoomDb, seats: SeatRow[]) {
  const needed = humansNeeded(room);
  if (humansOf(seats).length < needed) throw new HttpError(409, `need_players:${needed}`);
  if (!enoughHumans(room, seats)) throw new HttpError(409, 'need_opponents');
  const names = BOT_NAMES.filter((n) => !seats.some((s) => s.name === n));
  const humanLevels = humansOf(seats).map((s) => s.level);
  const botLevel = humanLevels.length ? Math.round(humanLevels.reduce((a, b) => a + b, 0) / humanLevels.length) : 1;
  for (const s of seatsOf(room.mode)) {
    if (seats.some((x) => x.seat === s)) continue;
    const name = names.shift()!;
    await tx`insert into room_seats (room_id, seat, is_bot, name, level, ready) values (${room.id}, ${s}, true, ${name}, ${botLevel}, true)`;
    seats.push({ seat: s, user_id: null, is_bot: true, name, level: botLevel, ready: true, away: false, left_game: false, strikes: 0 });
  }
  seats.sort((a, b) => a.seat - b.seat);
  const infos = seats.map(toSeatInfo);
  const stake = effectiveStake(room.mode, room.stake, infos);
  const humans = infos.filter((s) => !s.isBot && s.userId);
  if (stake > 0) for (const h of humans) await noGuests(tx, h.userId!);

  const state = newGame(Math.random, room.rules);
  const turnMs = room.turn_seconds * 1000;
  const sponsor = await pickSponsor(tx, room).catch((e) => (console.error('pickSponsor', e), null));
  const [game] = await tx`
    insert into games (room_id, public_state, stake, pot, turn_ms, auto_delay_ms, sponsor_id)
    values (${room.id}, ${tx.json(publicState(state) as never)}, ${stake}, ${stake * humans.length}, ${turnMs}, ${autoDelay(state, infos, turnMs)}, ${sponsor})
    returning id`;
  // Every person at this table is one view of the sponsor's logo (what a view package counts).
  if (sponsor) await tx`update sponsors set views_used = views_used + ${humans.length} where id = ${sponsor}`;
  if (stake > 0) {
    for (const h of humans) {
      const [ok] = await tx`update profiles set chips = chips - ${stake} where id = ${h.userId} and chips >= ${stake} returning id`;
      if (!ok) throw new HttpError(409, `not_enough_chips:${h.name}`); // rolls back every debit
      await tx`insert into chip_ledger (user_id, delta, reason, game_id) values (${h.userId}, ${-stake}, 'stake', ${game.id})`;
    }
    await tx`update side_bets set game_id = ${game.id} where room_id = ${room.id} and status = 'open'`;
  } else {
    // Nobody to bet against (all bots on the other side): side bets would be free money vs bots.
    await refundSideBets(tx, room.id);
  }
  await tx`insert into game_private (game_id, state) values (${game.id}, ${tx.json(state as never)})`;
  for (const s of infos) {
    await tx`insert into game_hands (game_id, seat, user_id, tiles) values (${game.id}, ${s.seat}, ${s.userId}, ${tx.json(state.hands[s.seat] as never)})`;
  }
  await tx`update rooms set phase = 'playing', phase_ends_at = null, current_game = ${game.id}, updated_at = now() where id = ${room.id}`;
  if (room.kind === 'tournament') await tx`update tournament_matches set status = 'playing' where room_id = ${room.id}`;
  return game.id as string;
}

/** The sponsor printed on this game's felt: one of those running on this kind of table, by weight. */
async function pickSponsor(tx: Tx, room: RoomDb): Promise<string | null> {
  const live = await tx`
    select id, weight, salas, custom, tournaments, tournament_codes, paused, starts_at, ends_at, max_views, views_used from sponsors
    where not paused and starts_at <= now() and (ends_at is null or ends_at > now())
      and (max_views is null or views_used < max_views)`;
  if (!live.length) return null;
  const [t] = room.tournament_id ? await tx`select code from tournaments where id = ${room.tournament_id}` : [];
  const table = { kind: room.kind, stake: room.stake, tournamentCode: t?.code ?? null };
  const fits = live.filter((s) => sponsorMatches({
    salas: s.salas, custom: s.custom, tournaments: s.tournaments, tournamentCodes: s.tournament_codes,
    paused: s.paused, startsAt: s.starts_at, endsAt: s.ends_at, maxViews: s.max_views, viewsUsed: s.views_used,
  }, table));
  return (pickWeighted(fits as { id: string; weight: number }[])?.id as string | undefined) ?? null;
}

async function lockGame(tx: Tx, gameId: string, uid: string) {
  const [game] = await tx<GameDb[]>`
    select g.*, p.state, extract(epoch from g.last_move_at) * 1000 as last_ms
    from games g join game_private p on p.game_id = g.id
    where g.id = ${gameId} for update of g`;
  if (!game) throw new HttpError(404, 'game_not_found');
  const [room] = await tx<RoomDb[]>`select *, false as phase_due from rooms where id = ${game.room_id}`;
  const seats = await tx<SeatRow[]>`select * from room_seats where room_id = ${game.room_id} order by seat`;
  mySeat(seats, uid);
  return { game, room, state: game.state as GameState, seats };
}

/** `delayMs` replaces the usual delay (Arcade Cambio: the rest of the same turn, not a new one). */
async function saveGame(tx: Tx, room: RoomDb, game: GameDb, next: GameState, seats: SeatRow[], dealt = false, delayMs?: number) {
  const prev = game.state;
  const finished = next.winner !== null;
  await tx`
    update games set public_state = ${tx.json(publicState(next) as never)}, version = version + 1,
      last_move_at = now(), auto_delay_ms = ${delayMs ?? autoDelay(next, seats.map(toSeatInfo), game.turn_ms)},
      finished_at = case when ${finished} then now() end
    where id = ${game.id}`;
  await tx`update game_private set state = ${tx.json(next as never)} where game_id = ${game.id}`;
  for (let s = 0; s < next.hands.length; s++) {
    if (dealt || JSON.stringify(prev.hands[s]) !== JSON.stringify(next.hands[s])) {
      await tx`update game_hands set tiles = ${tx.json(next.hands[s] as never)} where game_id = ${game.id} and seat = ${s}`;
    }
  }
  if (finished && !game.settled) await settle(tx, room, game, next, seats);
}

/** Pot, side bets, XP and stats — once, when the game ends. */
async function settle(tx: Tx, room: RoomDb, game: GameDb, end: GameState, seats: SeatRow[]) {
  const mode = room.mode;
  for (const p of payouts(mode, game.stake, seats.map(toSeatInfo), end)) {
    await tx`update profiles set chips = chips + ${p.amount}, biggest_pot = greatest(biggest_pot, ${p.amount}) where id = ${p.userId}`;
    await tx`insert into chip_ledger (user_id, delta, reason, game_id) values (${p.userId}, ${p.amount}, 'payout', ${game.id})`;
  }

  const bets = await tx`select * from side_bets where game_id = ${game.id} and status = 'open'`;
  for (const b of bets) {
    const seat = seats.find((s) => s.user_id === b.user_id);
    const won = !!seat && sideBetWon(b.kind as SideBetKind, end, sideOf(mode, seat.seat));
    const payout = won ? Math.floor(b.amount * Number(b.multiplier)) : 0;
    await tx`update side_bets set status = ${won ? 'won' : 'lost'}, payout = ${payout} where id = ${b.id}`;
    if (won) {
      await tx`update profiles set chips = chips + ${payout} where id = ${b.user_id}`;
      await tx`insert into chip_ledger (user_id, delta, reason, game_id) values (${b.user_id}, ${payout}, 'side_bet_win', ${game.id})`;
    }
  }

  const order = standings(end.scores);
  if (isArcade(end.rules)) {
    // Arcade results are kept apart: no XP, Traditional stats, missions or chests until Arcade has its own rewards.
    for (const s of humansOf(seats)) {
      const won = end.winner === sideOf(mode, s.seat);
      await tx`update profiles set arcade_games = arcade_games + 1, arcade_wins = arcade_wins + ${won ? 1 : 0} where id = ${s.user_id}`;
    }
    await tx`update games set settled = true where id = ${game.id}`;
    await tx`update rooms set phase = 'finished', updated_at = now() where id = ${room.id}`;
    return;
  }
  // A Rival Bonus only exists when the winners really beat a complete human
  // table. Private/custom tables and forfeited matches cannot be used to farm it.
  const rivalXp = room.kind !== 'custom'
    && seats.length === seatsNeeded(mode)
    && seats.every((s) => !s.is_bot && !!s.user_id && !s.left_game)
    && end.winner !== null
    ? rivalBonus(mode, end.winner, seats.map((s) => ({ seat: s.seat as Seat, level: s.level })))
    : 0;
  for (const s of humansOf(seats)) {
    const side = sideOf(mode, s.seat);
    const won = end.winner === side;
    const capicuas = end.tally.capicuas[side];
    const pollona = won && isPollona(end);
    const xp = s.left_game ? LEAVER_XP : gameXp({ won, capicuas, pollona, placedSecond: mode === 'ffa' && order[1]?.side === side }) + (won ? rivalXp : 0);
    await tx`
      update profiles set xp = greatest(0, xp + ${xp}), games = games + 1, wins = wins + ${won ? 1 : 0},
        capicuas = capicuas + ${capicuas}, pollonas = pollonas + ${pollona ? 1 : 0}
      where id = ${s.user_id}`;
  }
  // Winners who beat at least one other person get a chest, if they have a free slot.
  const people = humansOf(seats);
  if (people.length >= 2) {
    for (const s of people) {
      const won = mode === 'ffa' ? order[0]?.side === sideOf(mode, s.seat) : end.winner === sideOf(mode, s.seat);
      if (!won || s.left_game || (await isGuest(tx, s.user_id!))) continue;
      await grantChest(tx, s.user_id!, game.id);
    }
  }
  await tx`update games set settled = true where id = ${game.id}`;
  await tx`update rooms set phase = 'finished', updated_at = now() where id = ${room.id}`;
  if (room.kind === 'tournament') {
    // Side 0 (seats 0 and 2) is always the match's entry A.
    const [m] = await tx<MatchDb[]>`select * from tournament_matches where room_id = ${room.id}`;
    if (m) await resolveMatch(tx, m, end.winner === 0 ? m.entry_a! : m.entry_b!, 'played');
  }
}

async function grantChest(tx: Tx, uid: string, gameId: string) {
  const taken = (await tx`select slot from chests where user_id = ${uid}`).map((r) => r.slot as number);
  const slot = Array.from({ length: CHEST_SLOTS }, (_, i) => i).find((i) => !taken.includes(i));
  if (slot === undefined) return; // all slots full — open some!
  await tx`insert into chests (user_id, slot, kind, game_id) values (${uid}, ${slot}, ${rollChest()}, ${gameId})`;
}

async function openChest(tx: Tx, uid: string, chest: { id: string; kind: ChestKind }) {
  const reward = chestReward(chest.kind);
  await tx`delete from chests where id = ${chest.id}`;
  await tx`update profiles set chips = chips + ${reward.chips}, xp = xp + ${reward.xp} where id = ${uid}`;
  await tx`insert into chip_ledger (user_id, delta, reason, note) values (${uid}, ${reward.chips}, 'chest', ${chest.kind})`;
  return { kind: chest.kind, ...reward };
}

/** Someone left or came back mid-game: the server's timing for the current turn changes. */
async function refreshDelay(tx: Tx, room: RoomDb, seats: SeatRow[]) {
  if (room.phase !== 'playing' || !room.current_game) return;
  const [g] = await tx`select p.state, g.turn_ms from game_private p join games g on g.id = p.game_id where p.game_id = ${room.current_game}`;
  if (!g) return;
  await tx`update games set auto_delay_ms = ${autoDelay(g.state as GameState, seats.map(toSeatInfo), g.turn_ms)} where id = ${room.current_game}`;
}

/** A lobby deadline passed: ready check → break up (public) or forfeit (tournament); countdown → deal. */
async function roomDeadline(tx: Tx, room: RoomDb, seats: SeatRow[]) {
  if (room.phase === 'ready') {
    if (room.kind === 'tournament') return await resolveNoShows(tx, room, seats);
    const silent = humansOf(seats).filter((s) => !s.ready).map((s) => s.user_id!);
    await breakUpTable(tx, room, seats, silent);
    return { phase: 'closed' };
  }
  if (room.phase === 'countdown') {
    if (!enoughHumans(room, seats)) {
      await tx`update rooms set phase = 'lobby', phase_ends_at = null, updated_at = now() where id = ${room.id}`;
      return { phase: 'lobby' };
    }
    const gameId = await startGame(tx, room, seats);
    return { phase: 'playing', gameId };
  }
  return { phase: room.phase };
}

// ---------- tournaments ----------

async function lockTournament(tx: Tx, id: string) {
  const [t] = await tx<TournamentDb[]>`select * from tournaments where id = ${id} for update`;
  if (!t) throw new HttpError(404, 'tournament_not_found');
  return { ...t, pot: Number(t.pot) };
}

const entriesOf = (tx: Tx, tournamentId: string) =>
  tx<EntryDb[]>`select id, player1, player2 from tournament_entries where tournament_id = ${tournamentId} order by created_at`;
const playersOf = (e: EntryDb) => (e.player2 ? [e.player1, e.player2] : [e.player1]);

async function payBuyIn(tx: Tx, t: TournamentDb, uid: string) {
  if (t.buy_in === 0) return;
  await noGuests(tx, uid);
  const [ok] = await tx`update profiles set chips = chips - ${t.buy_in} where id = ${uid} and chips >= ${t.buy_in} returning id`;
  if (!ok) throw new HttpError(409, 'balance_too_low');
  await tx`insert into chip_ledger (user_id, delta, reason, note) values (${uid}, ${-t.buy_in}, 'tournament_buyin', ${t.name})`;
  await tx`update tournaments set pot = pot + ${t.buy_in} where id = ${t.id}`;
}

async function refundBuyIn(tx: Tx, t: TournamentDb, uid: string) {
  if (t.buy_in === 0) return;
  await tx`update profiles set chips = chips + ${t.buy_in} where id = ${uid}`;
  await tx`insert into chip_ledger (user_id, delta, reason, note) values (${uid}, ${t.buy_in}, 'refund', ${t.name})`;
  await tx`update tournaments set pot = pot - ${t.buy_in} where id = ${t.id}`;
}

/** Takes one person off the sign-up list (their partner keeps the pair) and gives the buy-in back. */
async function removeFromTournament(tx: Tx, t: TournamentDb, e: EntryDb, uid: string) {
  if (e.player2 === uid) await tx`update tournament_entries set player2 = null where id = ${e.id}`;
  else if (e.player2) await tx`update tournament_entries set player1 = player2, player2 = null where id = ${e.id}`;
  else await tx`delete from tournament_entries where id = ${e.id}`;
  await tx`delete from tournament_checkins where tournament_id = ${t.id} and user_id = ${uid}`;
  await refundBuyIn(tx, t, uid);
}

/** Buzz a player's phone (the push function words it in their language). Never fails the caller. */
async function notify(q: Tx | postgres.Sql, userId: string, payload: Record<string, unknown>) {
  await q`select notify_push(${userId}, ${q.json(payload as never)})`.catch((e) => console.error('notify', e));
}

/** Everyone signed up (players of every entry). */
const signedUp = async (tx: Tx, tournamentId: string) => (await entriesOf(tx, tournamentId)).flatMap(playersOf);

/** Signed up and checked in. */
async function checkedIn(tx: Tx, tournamentId: string) {
  return new Set((await tx`select user_id from tournament_checkins where tournament_id = ${tournamentId}`).map((r) => r.user_id as string));
}

/**
 * Close the sign-ups and draw the bracket. By the clock (scheduled start): whoever
 * hasn't checked in is taken off the list first, and if too few are left it's
 * cancelled with everyone's buy-in back. By the host: a scheduled tournament
 * starts early only once everyone signed up has checked in.
 */
/**
 * `by`: the host (only once everyone checked in), the clock at the start time (whoever didn't
 * check in is taken off), or an admin (starts it as it stands, nobody taken off).
 */
async function startTournament(tx: Tx, t: TournamentDb, by: 'host' | 'clock' | 'admin') {
  const dropped: string[] = [];
  if (t.starts_at && by !== 'admin') {
    const here = await checkedIn(tx, t.id);
    const missing = (await signedUp(tx, t.id)).filter((p) => !here.has(p));
    if (by === 'host') {
      if (!checkInOpen(t.starts_at.getTime(), Date.now())) throw new HttpError(409, 'checkin_not_open');
      if (missing.length) throw new HttpError(409, 'not_everyone_checked_in');
    }
    for (const p of missing) {
      // Re-read: taking player1 off a pair moves player2 up.
      const e = (await entriesOf(tx, t.id)).find((x) => x.player1 === p || x.player2 === p);
      if (e) await removeFromTournament(tx, t, e, p);
      dropped.push(p);
    }
  }
  let entries = await entriesOf(tx, t.id);
  if (t.mode === '2v2') {
    const solo = entries.filter((e) => !e.player2);
    const xp = solo.length ? await tx<{ id: string; xp: number }[]>`
      select id, coalesce(xp, 0)::int as xp from profiles where id in ${tx(solo.map((e) => e.player1))}` : [];
    const protectedEntry = solo.find((e) => e.player1 === t.host)?.id;
    const matched = pairPartners(solo.map((e) => ({
      id: e.id,
      xp: Number(xp.find((p) => p.id === e.player1)?.xp ?? 0),
    })), t.partner_matching ?? 'random', protectedEntry);
    const byEntry = new Map(solo.map((e) => [e.id, e]));
    for (const [pa, pb] of matched.pairs) {
      const a = byEntry.get(pa.id)!;
      const b = byEntry.get(pb.id)!;
      await tx`delete from tournament_entries where id = ${b.id}`;
      await tx`update tournament_entries set player2 = ${b.player1} where id = ${a.id}`;
    }
    if (matched.leftover) {
      const left = byEntry.get(matched.leftover.id)!;
      await removeFromTournament(tx, t, left, left.player1);
      dropped.push(left.player1);
    }
    entries = await entriesOf(tx, t.id);
  }
  const people = entries.reduce((n, e) => n + playersOf(e).length, 0);
  if (entries.length < minEntries(t.mode) || people < TOURNAMENT.minPlayers) {
    if (by !== 'clock') throw new HttpError(409, 'tournament_need_people'); // rolls back any pairing above
    // Not enough people showed up: call it off, everyone gets their buy-in back.
    for (const e of entries) for (const p of playersOf(e)) await refundBuyIn(tx, t, p);
    await tx`update tournaments set phase = 'cancelled', cancel_reason = 'not_enough' where id = ${t.id}`;
    for (const p of [...entries.flatMap(playersOf), ...dropped]) await notify(tx, p, { kind: 'tournament_cancelled', name: t.name, code: t.code });
    return;
  }
  for (const p of dropped) await notify(tx, p, { kind: 'checkin_missed', name: t.name, code: t.code });
  const rounds = roundCount(entries.length);
  await tx`update tournaments set phase = 'playing', rounds = ${rounds}, started_at = now() where id = ${t.id}`;
  // The first round: fixed matches (an admin's first, then players' picks in a 'pick'
  // tournament) and everyone else drawn or seeded by XP (a pair counts both players' XP).
  const strength = await tx<{ id: string; xp: number }[]>`
    select e.id, coalesce(p1.xp, 0) + coalesce(p2.xp, 0) as xp
    from tournament_entries e join profiles p1 on p1.id = e.player1 left join profiles p2 on p2.id = e.player2
    where e.tournament_id = ${t.id}`;
  const fixed = await tx<{ entry_a: string; entry_b: string; set_by: string }[]>`
    select entry_a, entry_b, set_by from tournament_pairs where tournament_id = ${t.id}
    order by (set_by = 'admin') desc, created_at`;
  const pairs = drawFirstRound(
    entries.map((e) => ({ id: e.id, xp: Number(strength.find((x) => x.id === e.id)?.xp ?? 0) })),
    t.seeding ?? 'random',
    fixed.filter((f) => f.set_by === 'admin' || t.seeding === 'pick').map((f) => [f.entry_a, f.entry_b] as [string, string]),
  ).map(([a, b]) => [a.id, b?.id ?? null] as [string, string | null]);
  for (let r = 1; r <= rounds; r++) {
    for (let slot = 0; slot < 2 ** (rounds - r); slot++) {
      const [a, b] = r === 1 ? pairs[slot] : [null, null];
      await tx`insert into tournament_matches (tournament_id, round, slot, entry_a, entry_b) values (${t.id}, ${r}, ${slot}, ${a}, ${b})`;
    }
  }
  const opening = await tx<MatchDb[]>`select * from tournament_matches where tournament_id = ${t.id} and round = 1 order by slot`;
  for (const m of opening) {
    if (m.entry_b) await createMatchRoom(tx, { ...t, rounds }, m);
    else await resolveMatch(tx, m, m.entry_a!, 'bye');
  }
}

/** Both sides of a match are known: open its table. Entry A sits on side 0 (seats 0 and 2), B on side 1. */
async function createMatchRoom(tx: Tx, t: TournamentDb, m: MatchDb) {
  const [a, b] = await Promise.all([m.entry_a, m.entry_b].map(async (id) => (await tx<EntryDb[]>`select id, player1, player2 from tournament_entries where id = ${id}`)[0]));
  const chairs: [number, string][] = t.mode === '1v1'
    ? [[0, a.player1], [1, b.player1]]
    : [[0, a.player1], [2, a.player2!], [1, b.player1], [3, b.player2!]];
  const room = await insertRoom(tx, {
    kind: 'tournament', mode: t.mode, rules: t.rules, stake: 0, turnSeconds: t.turn_seconds, visibility: 'private',
    host: null, phase: 'ready', phaseMs: TOURNAMENT.noShowMs, tournamentId: t.id,
  });
  const people = await tx`select id, display_name, xp from profiles where id in ${tx(chairs.map(([, uid]) => uid))}`;
  for (const [seat, uid] of chairs) {
    const p = people.find((x) => x.id === uid)!;
    await tx`insert into room_seats (room_id, seat, user_id, name, level) values (${room.id}, ${seat}, ${uid}, ${p.display_name}, ${levelFromXp(p.xp)})`;
  }
  await tx`update tournament_matches set room_id = ${room.id}, status = 'ready', ready_by = ${room.phase_ends_at} where id = ${m.id}`;
}

/**
 * A match is decided (played, bye, forfeit, or 'no_show' with no winner):
 * knock the loser(s) out and move the bracket on.
 */
async function resolveMatch(tx: Tx, m: MatchDb, winner: string | null, result: MatchResult) {
  // The tournament lock serialises the bracket: two semifinals ending together both see the final fill up.
  const t = await lockTournament(tx, m.tournament_id);
  const [cur] = await tx`select status from tournament_matches where id = ${m.id}`;
  if (cur.status === 'done') return;
  await tx`update tournament_matches set winner = ${winner}, status = 'done', result = ${result} where id = ${m.id}`;
  const losers = [m.entry_a, m.entry_b].filter((e): e is string => !!e && e !== winner);
  for (const loser of losers) {
    await tx`update tournament_entries set eliminated_round = ${m.round}, placement = ${placementFor(m.round, t.rounds!)} where id = ${loser}`;
  }
  if (m.round === t.rounds) return await finishTournament(tx, t, winner, losers);
  if (winner) {
    await tx`
      update tournament_matches set ${tx(m.slot % 2 === 0 ? 'entry_a' : 'entry_b')} = ${winner}
      where tournament_id = ${t.id} and round = ${m.round + 1} and slot = ${m.slot >> 1}`;
  }
  await advance(tx, t, m.round + 1, m.slot >> 1);
}

/**
 * Once both matches feeding it are over, the next match opens its table, sends
 * its only entry straight through (the other side was a double no-show), or —
 * nobody left on either side — passes the empty slot along too.
 */
async function advance(tx: Tx, t: TournamentDb, round: number, slot: number) {
  const [next] = await tx<MatchDb[]>`select * from tournament_matches where tournament_id = ${t.id} and round = ${round} and slot = ${slot}`;
  if (!next || next.status !== 'waiting') return;
  const feeders = await tx<{ status: string; winner: string | null }[]>`
    select status, winner from tournament_matches
    where tournament_id = ${t.id} and round = ${round - 1} and slot in (${2 * slot}, ${2 * slot + 1}) order by slot`;
  if (feeders.length < 2 || feeders.some((f) => f.status !== 'done')) return;
  const step = afterFeeders(feeders[0].winner, feeders[1].winner);
  if (step === 'empty') return await resolveMatch(tx, next, null, 'no_show');
  if ('bye' in step) return await resolveMatch(tx, next, step.bye, 'bye');
  await createMatchRoom(tx, t, { ...next, entry_a: step.play[0], entry_b: step.play[1] });
}

/**
 * The final is decided: placings, prize money (70/30), a trophy and bonus XP.
 * A final nobody showed up to has no champion: the two finalists share the pot.
 * Nobody reached the final at all: everyone gets their buy-in back.
 */
async function finishTournament(tx: Tx, t: TournamentDb, champion: string | null, runnersUp: string[]) {
  if (champion) await tx`update tournament_entries set placement = 1 where id = ${champion}`;
  await tx`update tournaments set phase = 'finished', champion = ${champion}, finished_at = now() where id = ${t.id}`;
  const entries = await entriesOf(tx, t.id);
  const players = (id: string | null) => {
    const e = entries.find((x) => x.id === id);
    return e ? playersOf(e) : [];
  };
  const seconds = runnersUp.flatMap(players);
  if (!champion && !seconds.length) {
    if (t.buy_in > 0) for (const p of entries.flatMap(playersOf)) await refundBuyIn(tx, t, p);
    return;
  }
  for (const p of prizes(t.pot, players(champion), seconds)) {
    await tx`update profiles set chips = chips + ${p.amount}, biggest_pot = greatest(biggest_pot, ${p.amount}) where id = ${p.userId}`;
    await tx`insert into chip_ledger (user_id, delta, reason, note) values (${p.userId}, ${p.amount}, 'tournament_prize', ${t.name})`;
  }
  for (const uid of players(champion)) {
    await tx`update profiles set tournaments_won = tournaments_won + 1, xp = xp + ${TOURNAMENT.championXp} where id = ${uid}`;
  }
  for (const uid of seconds) await tx`update profiles set xp = xp + ${TOURNAMENT.runnerUpXp} where id = ${uid}`;
}

/**
 * The Ready clock ran out and not everyone pressed it. Someone on each side:
 * the game starts, and the server plays the missing players' chairs until they
 * turn up (any tap takes the chair back). Only one side there: it goes through.
 * Nobody: both are out.
 */
async function resolveNoShows(tx: Tx, room: RoomDb, seats: SeatRow[]) {
  const [m] = await tx<MatchDb[]>`select * from tournament_matches where room_id = ${room.id}`;
  if (m && m.status !== 'done') {
    const ready = (side: number) => seats.filter((s) => sideOf(room.mode, s.seat) === side && s.ready && !s.is_bot).length;
    const outcome = noShowOutcome(ready(0), ready(1));
    if (outcome === 'play') {
      for (const s of seats) {
        if (s.is_bot || s.ready) continue;
        await tx`update room_seats set away = true where room_id = ${room.id} and seat = ${s.seat}`;
        s.away = true;
      }
      const gameId = await startGame(tx, room, seats);
      return { phase: 'playing', gameId };
    }
    if (outcome === 'none') await resolveMatch(tx, m, null, 'no_show');
    else await resolveMatch(tx, m, outcome === 'a' ? m.entry_a! : m.entry_b!, 'forfeit');
  }
  await tx`delete from rooms where id = ${room.id}`;
  return { phase: 'closed' };
}

/**
 * Nobody has touched this game for a minute past its turn timer — everyone
 * closed the app. The server plays it out so the bracket doesn't stall.
 */
async function playOutAbandoned(tx: Tx, roomId: string) {
  const [room] = await tx<RoomDb[]>`select *, false as phase_due from rooms where id = ${roomId}`;
  if (!room?.current_game) return;
  const [game] = await tx<GameDb[]>`
    select g.*, p.state, extract(epoch from g.last_move_at) * 1000 as last_ms
    from games g join game_private p on p.game_id = g.id
    where g.id = ${room.current_game} and not g.settled and g.auto_delay_ms is not null
      and g.last_move_at + (g.auto_delay_ms + ${TOURNAMENT.abandonedMs}) * interval '1 millisecond' < now()
    for update of g`;
  if (!game) return;
  const seats = await tx<SeatRow[]>`select * from room_seats where room_id = ${room.id} order by seat`;
  await tx`update room_seats set away = true where room_id = ${room.id} and not is_bot`;
  for (const s of seats) s.away = true;
  let s = game.state as GameState;
  for (let i = 0; i < 5000 && s.winner === null; i++) {
    s = s.handResult ? nextHand(s) : applyMove(s, forcedMove(s, s.turn) ?? chooseMove(s, s.turn));
  }
  await saveGame(tx, room, game, s, seats, true);
}

// ---------- actions ----------

export const handlers = {
  // --- public salas ---

  async queue_join(uid: string, { stake, mode, ruleset = 'traditional' }: { stake: number; mode: Mode; ruleset?: Ruleset }) {
    const sala = salaFor(stake);
    if (!sala || !MODES.includes(mode) || !RULESETS.includes(ruleset)) throw new HttpError(400, 'bad_sala');
    if (ruleset === 'arcade' && !arcadeAllowed(mode, stake)) throw new HttpError(400, 'bad_sala');
    return await sql.begin(async (tx) => {
      const p = await me(tx, uid);
      const active = await activeRoomOf(tx, uid);
      if (active) return { roomId: active };
      await notBanned(tx, uid);
      if (stake > 0) await noGuests(tx, uid); // friendly (stake 0) is open to guests
      if (p.queue_blocked_until && new Date(p.queue_blocked_until).getTime() > Date.now()) throw new HttpError(409, 'queue_blocked');
      if (p.chips < sala.minBalance) throw new HttpError(409, 'balance_too_low');
      await tx`
        insert into queue (user_id, stake, mode, level, ruleset) values (${uid}, ${stake}, ${mode}, ${p.level}, ${ruleset})
        on conflict (user_id) do update set stake = excluded.stake, mode = excluded.mode, level = excluded.level, ruleset = excluded.ruleset, joined_at = now()`;
      const roomId = await tryMatch(tx, stake, mode, ruleset);
      return roomId ? { roomId } : { queued: true };
    });
  },

  async queue_leave(uid: string) {
    await sql`delete from queue where user_id = ${uid}`;
    return { ok: true };
  },

  /** Polled while waiting: seated yet? If not, try to make a match (bots fill in after a while). */
  async queue_status(uid: string) {
    return await sql.begin(async (tx) => {
      const active = await activeRoomOf(tx, uid);
      if (active) return { roomId: active };
      const [q] = await tx`select stake, mode, ruleset, extract(epoch from now() - joined_at) * 1000 as waited_ms from queue where user_id = ${uid}`;
      if (!q) return { idle: true };
      const roomId = await tryMatch(tx, q.stake, q.mode, q.ruleset);
      if (roomId) return { roomId };
      const [{ n }] = await tx`select count(*)::int as n from queue where stake = ${q.stake} and mode = ${q.mode} and ruleset = ${q.ruleset}`;
      return { queued: true, waitedMs: Math.round(Number(q.waited_ms)), waiting: n };
    });
  },

  async ready(uid: string, { roomId, ready = true }: { roomId: string; ready?: boolean }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      const mine = mySeat(seats, uid);
      if (!['lobby', 'ready'].includes(room.phase)) return { ok: true };
      await tx`update room_seats set ready = ${ready} where room_id = ${room.id} and seat = ${mine.seat}`;
      mine.ready = ready;
      // Ready check passed → short countdown.
      if (room.phase === 'ready' && humansOf(seats).every((s) => s.ready)) {
        await tx`update rooms set phase = 'countdown', phase_ends_at = ${later(LOBBY.allReadyMs)}, updated_at = now() where id = ${room.id}`;
      } else {
        await tx`update rooms set updated_at = now() where id = ${room.id}`;
      }
      return { ok: true };
    });
  },

  async decline(uid: string, { roomId }: { roomId: string }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      mySeat(seats, uid);
      if (room.kind !== 'public' || !['ready', 'countdown'].includes(room.phase)) throw new HttpError(409, 'too_late');
      await breakUpTable(tx, room, seats, [uid]);
      return { ok: true };
    });
  },

  /** Any seated player calls this when a lobby deadline passes. */
  async tick_room(uid: string, { roomId }: { roomId: string }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      mySeat(seats, uid);
      if (!room.phase_due) return { phase: room.phase };
      return await roomDeadline(tx, room, seats);
    });
  },

  // --- custom rooms ---

  async create_custom(uid: string, { settings }: { settings: unknown }) {
    const c = validateCustom((settings ?? {}) as never);
    if (!c) throw new HttpError(400, 'bad_settings');
    return await sql.begin(async (tx) => {
      const p = await me(tx, uid);
      if (await activeRoomOf(tx, uid)) throw new HttpError(409, 'already_in_room');
      await notBanned(tx, uid);
      if (c.stake > 0) await noGuests(tx, uid);
      if (p.chips < c.stake) throw new HttpError(409, 'balance_too_low');
      await tx`delete from queue where user_id = ${uid}`;
      const room = await insertRoom(tx, {
        kind: 'custom', mode: c.mode, rules: customRules(c), stake: c.stake, turnSeconds: c.turnSeconds,
        visibility: c.visibility, host: uid, phase: 'lobby', phaseMs: null,
      });
      await tx`insert into room_seats (room_id, seat, user_id, name, level, ready) values (${room.id}, 0, ${uid}, ${p.display_name}, ${p.level}, true)`;
      return { roomId: room.id, code: room.code };
    });
  },

  /**
   * Sit at a table (by code, or by id from an invite). Already seated elsewhere:
   * refused with `in_game` (a game in progress) or `already_in_room` (anything
   * else), unless `switchTable` says to leave that table first. 'lobby' moves
   * only from a table that isn't playing; `true` also forfeits a game in progress.
   */
  async join_room(uid: string, { code, roomId, switchTable = false }: { code?: string; roomId?: string; switchTable?: boolean | 'lobby' }) {
    return await sql.begin(async (tx) => {
      const [r] = roomId
        ? await tx`select id from rooms where id = ${roomId}`
        : await tx`select id from rooms where code = ${String(code ?? '').toUpperCase()}`;
      if (!r) throw new HttpError(404, 'room_not_found');
      const { room, seats } = await lockRoom(tx, r.id);
      const mine = seats.find((s) => s.user_id === uid);
      if (mine) {
        if (mine.forfeited && room.phase === 'playing') throw new HttpError(409, 'forfeited');
        if (mine.left_game && room.kind === 'tournament' && room.phase !== 'playing' && room.phase !== 'finished') {
          // Back from another table before the match started: the chair is theirs again.
          await tx`update room_seats set left_game = false where room_id = ${room.id} and seat = ${mine.seat}`;
          return { roomId: room.id };
        }
        if (mine.away && !mine.left_game) return { roomId: room.id };
        if (mine.left_game && room.phase === 'playing') {
          // Came back: take the chair over from the server again.
          await tx`update room_seats set away = false, left_game = false, strikes = 0 where room_id = ${room.id} and seat = ${mine.seat}`;
          mine.away = false;
          await refreshDelay(tx, room, seats);
        }
        return { roomId: room.id };
      }
      if (room.kind !== 'custom') throw new HttpError(403, 'not_in_room');
      if (room.phase !== 'lobby') throw new HttpError(409, 'game_in_progress');
      await notBanned(tx, uid);
      if (room.stake > 0) await noGuests(tx, uid);
      const p = await me(tx, uid);
      if (p.chips < room.stake) throw new HttpError(409, 'balance_too_low');
      const free = seatsOf(room.mode).find((s) => !seats.some((x) => x.seat === s));
      if (free === undefined) throw new HttpError(409, 'room_full');
      // Everything about the new table checks out: only now leave the old one.
      const active = await activeRoomOf(tx, uid);
      if (active) {
        const [cur] = await tx`select phase from rooms where id = ${active}`;
        const playing = cur?.phase === 'playing';
        if (!switchTable || (playing && switchTable !== true)) throw new HttpError(409, playing ? 'in_game' : 'already_in_room');
        await vacateFor(tx, active, uid);
      }
      await tx`delete from queue where user_id = ${uid}`;
      await tx`insert into room_seats (room_id, seat, user_id, name, level) values (${room.id}, ${free}, ${uid}, ${p.display_name}, ${p.level})`;
      await tx`update rooms set updated_at = now() where id = ${room.id}`;
      return { roomId: room.id };
    });
  },

  async take_seat(uid: string, { roomId, seat }: { roomId: string; seat: number }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      if (room.phase !== 'lobby') throw new HttpError(409, 'game_in_progress');
      if (!seatsOf(room.mode).includes(seat as Seat)) throw new HttpError(400, 'bad_seat');
      const mine = mySeat(seats, uid);
      if (seats.some((s) => s.seat === seat)) throw new HttpError(409, 'seat_taken');
      await tx`update room_seats set seat = ${seat} where room_id = ${room.id} and seat = ${mine.seat}`;
      await tx`update rooms set updated_at = now() where id = ${room.id}`;
      return { ok: true };
    });
  },

  /** Host starts once every person at the table is ready; bots fill empty chairs. */
  async start(uid: string, { roomId }: { roomId: string }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      if (room.host !== uid) throw new HttpError(403, 'host_only');
      if (room.phase !== 'lobby') throw new HttpError(409, 'game_in_progress');
      const needed = humansNeeded(room);
      if (humansOf(seats).length < needed) throw new HttpError(409, `need_players:${needed}`);
      if (!enoughHumans(room, seats)) throw new HttpError(409, 'need_opponents');
      if (!humansOf(seats).every((s) => s.ready || s.user_id === uid)) throw new HttpError(409, 'not_everyone_ready');
      await tx`update rooms set phase = 'countdown', phase_ends_at = ${later(LOBBY.allReadyMs)}, updated_at = now() where id = ${room.id}`;
      return { ok: true };
    });
  },

  async rematch(uid: string, { roomId }: { roomId: string }) {
    return await sql.begin(async (tx) => {
      const { room } = await lockRoom(tx, roomId);
      if (room.kind !== 'custom' || room.host !== uid) throw new HttpError(403, 'host_only');
      if (room.phase !== 'finished') throw new HttpError(409, 'game_in_progress');
      await tx`delete from room_seats where room_id = ${room.id} and (is_bot or left_game)`;
      await tx`update room_seats set ready = (user_id = ${uid}), away = false, strikes = 0 where room_id = ${room.id}`;
      await tx`update rooms set phase = 'lobby', current_game = null, updated_at = now() where id = ${room.id}`;
      return { ok: true };
    });
  },

  /**
   * Leave a table. Mid-game the server plays the chair: by default the game stays
   * theirs to come back to (and they can't sit anywhere else until it ends);
   * `forfeit` gives it up for good — same leaver rules, but they're free to play
   * another game straight away.
   */
  async leave_room(uid: string, { roomId, forfeit = false }: { roomId: string; forfeit?: boolean }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      const mine = mySeat(seats, uid);
      if (room.phase === 'playing') {
        // Stake stays in the pot; the server plays for them.
        await tx`update room_seats set away = true, left_game = true, forfeited = forfeited or ${!!forfeit} where room_id = ${room.id} and seat = ${mine.seat}`;
        mine.away = true;
        await refreshDelay(tx, room, seats);
        return { ok: true, forfeited: !!forfeit || !!mine.forfeited };
      }
      if (room.kind === 'public' && (room.phase === 'ready' || room.phase === 'countdown')) {
        await breakUpTable(tx, room, seats, [uid]);
        return { ok: true };
      }
      if (room.kind === 'tournament' && room.phase !== 'finished') {
        // The chair stays yours until the Ready clock runs out; walking away just means "not ready".
        if (room.phase === 'ready') await tx`update room_seats set ready = false where room_id = ${room.id} and seat = ${mine.seat}`;
        return { ok: true };
      }
      await leaveCustom(tx, room, seats, uid);
      return { ok: true };
    });
  },

  // --- side bets ---

  async side_bet(uid: string, { roomId, kind, amount }: { roomId: string; kind: SideBetKind; amount: number }) {
    if (!SIDE_BET_KINDS.includes(kind) || !Number.isInteger(amount) || amount <= 0) throw new HttpError(400, 'bad_bet');
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      mySeat(seats, uid);
      await noGuests(tx, uid);
      if (!['lobby', 'ready', 'countdown'].includes(room.phase)) throw new HttpError(409, 'bets_closed');
      const multiplier = sideBetMultiplier(room.rules, kind);
      if (!multiplier || room.stake === 0) throw new HttpError(409, 'no_side_bets');
      const [{ total }] = await tx`select coalesce(sum(amount), 0)::int as total from side_bets where room_id = ${room.id} and user_id = ${uid} and status = 'open'`;
      if (total + amount > sideBetLimit(room.stake)) throw new HttpError(409, 'bet_limit');
      const [ok] = await tx`update profiles set chips = chips - ${amount} where id = ${uid} and chips >= ${amount} returning id`;
      if (!ok) throw new HttpError(409, 'balance_too_low');
      const [bet] = await tx`
        insert into side_bets (room_id, user_id, kind, amount, multiplier)
        values (${room.id}, ${uid}, ${kind}, ${amount}, ${multiplier})
        on conflict (room_id, user_id, kind) do nothing returning id`;
      if (!bet) throw new HttpError(409, 'already_bet'); // rolls back the debit
      await tx`insert into chip_ledger (user_id, delta, reason) values (${uid}, ${-amount}, 'side_bet')`;
      return { multiplier };
    });
  },

  async cancel_side_bet(uid: string, { roomId, kind }: { roomId: string; kind: SideBetKind }) {
    return await sql.begin(async (tx) => {
      const { room } = await lockRoom(tx, roomId);
      if (!['lobby', 'ready', 'countdown'].includes(room.phase)) throw new HttpError(409, 'bets_closed');
      const [b] = await tx`delete from side_bets where room_id = ${room.id} and user_id = ${uid} and kind = ${kind} and status = 'open' returning amount`;
      if (b) {
        await tx`update profiles set chips = chips + ${b.amount} where id = ${uid}`;
        await tx`insert into chip_ledger (user_id, delta, reason) values (${uid}, ${b.amount}, 'refund')`;
      }
      return { ok: true };
    });
  },

  // --- playing ---

  /**
   * Play a move. Arcade requests also carry `actionId` (a retry of an action
   * that already went through does nothing) and `version` (the state the
   * player saw: anything older is refused, so a stale tap can't spend a charge).
   */
  async move(uid: string, { gameId, move, actionId, version }: { gameId: string; move: Move; actionId?: string; version?: number }) {
    return await sql.begin(async (tx) => {
      const { game, room, state, seats } = await lockGame(tx, gameId, uid);
      const mine = mySeat(seats, uid);
      if (mine.forfeited) throw new HttpError(409, 'forfeited');
      const arcade = state.arcade;
      if (arcade && actionId && arcade.recent?.includes(actionId)) return { ok: true, duplicate: true };
      if (!arcade && move?.type !== 'play' && move?.type !== 'pass' && move?.type !== 'draw') throw new HttpError(400, 'illegal_move');
      if (state.turn !== mine.seat || state.handResult) throw new HttpError(409, 'not_your_turn');
      const elapsed = Date.now() - Number(game.last_ms);
      if (arcade) {
        if (version !== undefined && version !== game.version) throw new HttpError(409, 'stale_state');
        if (!mine.away && game.auto_delay_ms !== null && elapsed > game.auto_delay_ms + 2500) throw new HttpError(409, 'too_late');
      }
      let next: GameState;
      try {
        next = applyMove(state, move);
      } catch {
        throw new HttpError(400, 'illegal_move');
      }
      let delayMs: number | undefined;
      if (next.arcade) {
        if (actionId) next.arcade.recent = [...(arcade?.recent ?? []), String(actionId).slice(0, 64)].slice(-40);
        // Cambio doesn't end the turn, and it doesn't restart the clock either.
        if (move.type === 'cambio' && game.auto_delay_ms !== null) {
          const natural = autoDelay(next, seats.map(toSeatInfo), game.turn_ms);
          // last_move_at has microseconds, so `elapsed` is fractional; the column is an integer.
          delayMs = natural === game.turn_ms ? Math.max(1500, Math.round(game.auto_delay_ms - elapsed)) : natural ?? undefined;
        }
      }
      // Playing a tile means you're back: the server stops playing for you.
      if (mine.strikes > 0 || mine.away || mine.left_game) {
        await tx`update room_seats set strikes = 0, away = false, left_game = false where room_id = ${room.id} and seat = ${mine.seat}`;
        Object.assign(mine, { strikes: 0, away: false, left_game: false });
      }
      await saveGame(tx, room, game, next, seats, false, delayMs);
      return { ok: true };
    });
  },

  /** Seated players call this when auto_delay_ms runs out; the server acts only if something is due. */
  async tick(uid: string, { gameId }: { gameId: string }) {
    return await sql.begin(async (tx) => {
      const { game, room, state, seats } = await lockGame(tx, gameId, uid);
      // Arcade: the saved delay is the deadline (a Cambio keeps the turn's original one).
      const action = autoAction(state, seats.map(toSeatInfo), game.turn_ms, Number(game.last_ms), Date.now(), state.arcade ? game.auto_delay_ms : undefined);
      if (!action) return { acted: false };
      if (action.kind === 'nextHand') {
        await saveGame(tx, room, game, nextHand(state), seats, true);
        return { acted: true };
      }
      if (action.strike) {
        const s = seats.find((x) => x.seat === state.turn)!;
        s.strikes++;
        if (s.strikes >= MAX_STRIKES) s.away = true;
        await tx`update room_seats set strikes = ${s.strikes}, away = ${s.away} where room_id = ${room.id} and seat = ${s.seat}`;
      }
      await saveGame(tx, room, game, applyMove(state, action.move), seats);
      return { acted: true };
    });
  },

  /**
   * "Listo" between hands. The next hand deals once every person still at the
   * table is ready; otherwise `tick` deals it when the 25 s run out.
   */
  async next_hand(uid: string, { gameId }: { gameId: string }) {
    return await sql.begin(async (tx) => {
      const { game, room, state, seats } = await lockGame(tx, gameId, uid);
      if (!state.handResult || state.winner !== null) return { ok: true }; // someone already dealt
      const mine = mySeat(seats, uid);
      if (mine.forfeited) return { ok: true };
      const ready = new Set<number>([...(state.nextReady ?? []), mine.seat]);
      const waiting = seats.filter((s) => !s.is_bot && s.user_id && !s.away && !ready.has(s.seat));
      if (waiting.length === 0) {
        await saveGame(tx, room, game, nextHand(state), seats, true);
        return { ok: true, dealt: true };
      }
      // Only who's ready changes: the clock (last_move_at, auto_delay_ms) keeps running.
      const next: GameState = { ...state, nextReady: [...ready].sort((a, b) => a - b) as Seat[] };
      await tx`update games set public_state = ${tx.json(publicState(next) as never)}, version = version + 1 where id = ${game.id}`;
      await tx`update game_private set state = ${tx.json(next as never)} where game_id = ${game.id}`;
      return { ok: true, dealt: false };
    });
  },

  /** Back in your chair after the server played for you. */
  async im_back(uid: string, { roomId }: { roomId: string }) {
    return await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      const mine = mySeat(seats, uid);
      if (room.phase !== 'playing' || !mine.away) return { ok: true };
      if (mine.forfeited) throw new HttpError(409, 'forfeited');
      await tx`update room_seats set away = false, left_game = false, strikes = 0 where room_id = ${room.id} and seat = ${mine.seat}`;
      mine.away = false;
      await refreshDelay(tx, room, seats);
      return { ok: true };
    });
  },

  // --- chips ---

  async claim_daily(uid: string) {
    return await sql.begin(async (tx) => {
      await noGuests(tx, uid);
      const [p] = await tx`
        update profiles set chips = chips + ${CHIPS.daily}, last_daily = current_date
        where id = ${uid} and (last_daily is null or last_daily < current_date)
        returning chips`;
      if (!p) throw new HttpError(409, 'already_claimed');
      await tx`insert into chip_ledger (user_id, delta, reason) values (${uid}, ${CHIPS.daily}, 'daily')`;
      return { chips: Number(p.chips) };
    });
  },

  /** Broke? Once a day you get enough to keep playing. */
  async rescue(uid: string) {
    return await sql.begin(async (tx) => {
      await noGuests(tx, uid);
      const [p] = await tx`
        update profiles set chips = chips + ${CHIPS.rescue}, last_rescue = current_date
        where id = ${uid} and chips < ${CHIPS.rescueBelow} and (last_rescue is null or last_rescue < current_date)
        returning chips`;
      if (!p) throw new HttpError(409, 'no_rescue');
      await tx`insert into chip_ledger (user_id, delta, reason) values (${uid}, ${CHIPS.rescue}, 'rescue')`;
      return { chips: Number(p.chips) };
    });
  },

  // --- chests ---

  /** Start the timer on a locked chest. One chest unlocks at a time. */
  async chest_start(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const [c] = await tx`select * from chests where id = ${id} and user_id = ${uid} for update`;
      if (!c) throw new HttpError(404, 'no_chest');
      if (c.unlock_at) return { ok: true };
      const [busy] = await tx`select 1 from chests where user_id = ${uid} and unlock_at > now()`;
      if (busy) throw new HttpError(409, 'chest_busy');
      await tx`update chests set unlock_at = ${later(CHESTS[c.kind as ChestKind].unlockMin * 60_000)} where id = ${id}`;
      return { ok: true };
    });
  },

  async chest_open(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string; kind: ChestKind; ready: boolean }[]>`select id, kind, unlock_at <= now() as ready from chests where id = ${id} and user_id = ${uid} for update`;
      if (!c) throw new HttpError(404, 'no_chest');
      if (!c.ready) throw new HttpError(409, 'chest_locked');
      return await openChest(tx, uid, c);
    });
  },

  /** Pay chips to skip the wait. */
  async chest_rush(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const [c] = await tx<{ id: string; kind: ChestKind; left_ms: number | null }[]>`
        select id, kind, extract(epoch from (unlock_at - now())) * 1000 as left_ms
        from chests where id = ${id} and user_id = ${uid} for update`;
      if (!c) throw new HttpError(404, 'no_chest');
      const left = c.left_ms === null ? CHESTS[c.kind as ChestKind].unlockMin * 60_000 : Math.max(0, Number(c.left_ms));
      const cost = left > 0 ? rushCost(left) : 0;
      if (cost > 0) {
        const [ok] = await tx`update profiles set chips = chips - ${cost} where id = ${uid} and chips >= ${cost} returning id`;
        if (!ok) throw new HttpError(409, 'balance_too_low');
        await tx`insert into chip_ledger (user_id, delta, reason, note) values (${uid}, ${-cost}, 'chest_rush', ${c.kind})`;
      }
      return { ...(await openChest(tx, uid, c)), cost };
    });
  },

  // --- tournaments ---

  /**
   * Private (code or invite) or public (listed for anyone). An admin's official one: "Capicúa"
   * organizes it — the admin isn't entered and pays nothing — and the house prize starts the pot.
   */
  async tournament_create(uid: string, { settings }: { settings: unknown }) {
    const s = validateTournament((settings ?? {}) as never);
    if (!s) throw new HttpError(400, 'bad_settings');
    return await sql.begin(async (tx) => {
      const p = await me(tx, uid);
      await notBanned(tx, uid);
      const official = !!s.official;
      if (official && !(await isAdmin(tx, uid))) throw new HttpError(403, 'admin_only');
      const visibility = s.visibility ?? 'private';
      if (!official) {
        if (s.buyIn > 0) await noGuests(tx, uid);
        if (p.chips < s.buyIn) throw new HttpError(409, 'balance_too_low');
        if (visibility === 'public') {
          const [{ n }] = await tx`select count(*)::int as n from tournaments where host = ${uid} and visibility = 'public' and phase = 'lobby'`;
          if (n >= TOURNAMENT.maxOpenPublic) throw new HttpError(409, 'too_many_public');
        }
      }
      const prize = official ? s.prize ?? 0 : 0;
      let t: TournamentDb | undefined;
      for (let i = 0; i < 8 && !t; i++) {
        [t] = await tx<TournamentDb[]>`
          insert into tournaments (code, name, host, mode, size, buy_in, rules, turn_seconds, seeding, partner_matching,
                                   visibility, official, featured, prize, pot, description)
          values (${roomCode(Math.random, TOURNAMENT.codeLength)}, ${s.name}, ${uid}, ${s.mode}, ${s.size}, ${s.buyIn},
                  ${tx.json(tournamentRules(s) as never)}, ${s.turnSeconds}, ${s.seeding ?? 'random'}, ${s.partnerMatching ?? 'random'},
                  ${visibility}, ${official}, ${official && !!s.featured}, ${prize}, ${prize}, ${official ? s.description ?? null : null})
          on conflict (code) do nothing returning *`;
      }
      if (!t) throw new HttpError(503, 'no_code_available');
      t.pot = Number(t.pot);
      if (s.startsAt) {
        t.starts_at = new Date(s.startsAt);
        await tx`update tournaments set starts_at = ${t.starts_at} where id = ${t.id}`;
      }
      if (official) return { id: t.id, code: t.code };
      await tx`insert into tournament_entries (tournament_id, player1) values (${t.id}, ${uid})`;
      await payBuyIn(tx, t, uid);
      // The host is here already if check-in is open.
      if (t.starts_at && checkInOpen(t.starts_at.getTime(), Date.now())) {
        await tx`insert into tournament_checkins (tournament_id, user_id) values (${t.id}, ${uid})`;
      }
      return { id: t.id, code: t.code };
    });
  },

  /** What an invite shows before you join (members read the tournament directly). */
  async tournament_peek(uid: string, { code, id }: { code?: string; id?: string }) {
    const [t] = id
      ? await sql<TournamentDb[]>`select * from tournaments where id = ${id}`
      : await sql<TournamentDb[]>`select * from tournaments where code = ${String(code ?? '').toUpperCase()}`;
    if (!t) throw new HttpError(404, 'tournament_not_found');
    const entries = await sql<(EntryDb & { name1: string; name2: string | null })[]>`
      select e.id, e.player1, e.player2, p1.display_name as name1, p2.display_name as name2
      from tournament_entries e join profiles p1 on p1.id = e.player1 left join profiles p2 on p2.id = e.player2
      where e.tournament_id = ${t.id} order by e.created_at`;
    const [host] = await sql`select display_name from profiles where id = ${t.host}`;
    return {
      id: t.id, code: t.code, name: t.name, mode: t.mode, size: t.size, buyIn: t.buy_in, phase: t.phase,
      target: t.rules.target, host: t.official ? 'Capicúa' : host?.display_name ?? '', pot: Number(t.pot), seeding: t.seeding ?? 'random',
      partnerMatching: t.partner_matching ?? 'random',
      startsAt: t.starts_at ? new Date(t.starts_at).toISOString() : null,
      turnSeconds: t.turn_seconds, visibility: t.visibility ?? 'private', official: !!t.official,
      prize: Number(t.prize ?? 0), description: t.description ?? null,
      member: t.host === uid || entries.some((e) => e.player1 === uid || e.player2 === uid),
      entries: entries.map((e) => ({ id: e.id, names: [e.name1, e.name2].filter(Boolean), open: t.mode === '2v2' && !e.player2 })),
    };
  },

  /** Sign up: on your own, or (2v2, entryId) as the partner of someone still looking for one. */
  async tournament_join(uid: string, { id, code, entryId }: { id?: string; code?: string; entryId?: string }) {
    return await sql.begin(async (tx) => {
      const [row] = id
        ? await tx`select id from tournaments where id = ${id}`
        : await tx`select id from tournaments where code = ${String(code ?? '').toUpperCase()}`;
      if (!row) throw new HttpError(404, 'tournament_not_found');
      const t = await lockTournament(tx, row.id);
      const entries = await entriesOf(tx, t.id);
      if (entries.some((e) => e.player1 === uid || e.player2 === uid)) return { id: t.id };
      if (t.phase !== 'lobby' || (t.starts_at && t.starts_at.getTime() <= Date.now())) throw new HttpError(409, 'tournament_started');
      await notBanned(tx, uid);
      // Capacity counts people: in 2v2, solos pair up at the start, so 8 slots = 16 people however they signed up.
      const people = entries.reduce((n, e) => n + playersOf(e).length, 0);
      if (people >= t.size * playersPerEntry(t.mode)) throw new HttpError(409, 'tournament_full');
      if (entryId) {
        const e = entries.find((x) => x.id === entryId);
        if (!e || t.mode !== '2v2') throw new HttpError(404, 'team_not_found');
        if (e.player2) throw new HttpError(409, 'team_full');
        await tx`update tournament_entries set player2 = ${uid} where id = ${e.id}`;
      } else {
        await tx`insert into tournament_entries (tournament_id, player1) values (${t.id}, ${uid})`;
      }
      await payBuyIn(tx, t, uid);
      // Signing up during check-in means you're here.
      if (t.starts_at && checkInOpen(t.starts_at.getTime(), Date.now())) {
        await tx`insert into tournament_checkins (tournament_id, user_id) values (${t.id}, ${uid}) on conflict do nothing`;
      }
      return { id: t.id };
    });
  },

  /** "Estoy aquí": in the 15 minutes before the start. Whoever hasn't by the start is taken off the list. */
  async tournament_checkin(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.phase !== 'lobby' || !t.starts_at) throw new HttpError(409, 'tournament_started');
      if (!(await signedUp(tx, t.id)).includes(uid)) throw new HttpError(403, 'not_in_tournament');
      if (!checkInOpen(t.starts_at.getTime(), Date.now())) throw new HttpError(409, 'checkin_not_open');
      await tx`insert into tournament_checkins (tournament_id, user_id) values (${t.id}, ${uid}) on conflict do nothing`;
      return { ok: true };
    });
  },

  /** Before it starts: drop out and get the buy-in back. The host cancels instead. */
  async tournament_leave(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      if (t.host === uid) throw new HttpError(409, 'host_cannot_leave');
      const e = (await entriesOf(tx, t.id)).find((x) => x.player1 === uid || x.player2 === uid);
      if (e) await removeFromTournament(tx, t, e, uid);
      return { ok: true };
    });
  },

  async tournament_kick(uid: string, { id, userId }: { id: string; userId: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.host !== uid && !(await isAdmin(tx, uid))) throw new HttpError(403, 'host_only');
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      if (userId === uid) throw new HttpError(409, 'host_cannot_leave');
      const e = (await entriesOf(tx, t.id)).find((x) => x.player1 === userId || x.player2 === userId);
      if (e) await removeFromTournament(tx, t, e, userId);
      return { ok: true };
    });
  },

  async tournament_cancel(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.host !== uid && !(await isAdmin(tx, uid))) throw new HttpError(403, 'host_only');
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      for (const e of await entriesOf(tx, t.id)) for (const p of playersOf(e)) await refundBuyIn(tx, t, p);
      await tx`update tournaments set phase = 'cancelled', cancel_reason = 'host' where id = ${t.id}`;
      return { ok: true };
    });
  },

  /**
   * Host starts now: pairs up anyone without a partner, draws the bracket, opens
   * the first tables. A scheduled tournament starts early only once everyone
   * signed up has checked in; otherwise the clock starts it at its time.
   */
  async tournament_start(uid: string, { id }: { id: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      const host = t.host === uid;
      const admin = await isAdmin(tx, uid);
      if (!host && !admin) throw new HttpError(403, 'host_only');
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      // Official tournaments are created by an admin who is also stored as the host. Keep the
      // admin override in that case; otherwise the organizer is incorrectly forced through the
      // player check-in gate even though they are not one of the competitors.
      await startTournament(tx, t, admin ? 'admin' : 'host');
      return { ok: true };
    });
  },

  /**
   * Before the start: the host changes name, start time (or clears it), target, timer and how
   * the first round is matched; an admin may also change the size. A new start time clears
   * the check-ins and the reminders (everyone checks in again for the new time).
   */
  async tournament_edit(uid: string, { id, changes }: { id: string; changes: TournamentEdit }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      const admin = await isAdmin(tx, uid);
      if (t.host !== uid && !admin) throw new HttpError(403, 'host_only');
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      const c = validateTournamentEdit((changes ?? {}) as TournamentEdit, admin);
      if (!c) throw new HttpError(400, 'bad_settings');
      if (c.name) await tx`update tournaments set name = ${c.name} where id = ${t.id}`;
      if (c.target) await tx`update tournaments set rules = ${tx.json(tournamentRules({ mode: t.mode, target: c.target }) as never)} where id = ${t.id}`;
      if (c.turnSeconds) await tx`update tournaments set turn_seconds = ${c.turnSeconds} where id = ${t.id}`;
      if (c.size) {
        const people = (await entriesOf(tx, t.id)).reduce((n, e) => n + playersOf(e).length, 0);
        if (people > c.size * playersPerEntry(t.mode)) throw new HttpError(409, 'tournament_full');
        await tx`update tournaments set size = ${c.size} where id = ${t.id}`;
      }
      if (c.seeding && c.seeding !== t.seeding) {
        await tx`update tournaments set seeding = ${c.seeding} where id = ${t.id}`;
        // Players' picks only count in a 'pick' tournament (an admin's fixed matches stay).
        if (c.seeding !== 'pick') await tx`delete from tournament_pairs where tournament_id = ${t.id} and set_by = 'player'`;
      }
      if (c.partnerMatching && c.partnerMatching !== t.partner_matching) {
        if (t.mode !== '2v2') throw new HttpError(400, 'bad_settings');
        await tx`update tournaments set partner_matching = ${c.partnerMatching} where id = ${t.id}`;
      }
      if (c.visibility && c.visibility !== t.visibility) {
        if (t.official) throw new HttpError(409, 'official_is_public');
        if (c.visibility === 'public' && !admin) {
          const [{ n }] = await tx`select count(*)::int as n from tournaments where host = ${t.host} and visibility = 'public' and phase = 'lobby'`;
          if (n >= TOURNAMENT.maxOpenPublic) throw new HttpError(409, 'too_many_public');
        }
        // Made private: off the home screen too.
        await tx`update tournaments set visibility = ${c.visibility}, featured = featured and ${c.visibility === 'public'} where id = ${t.id}`;
      }
      if (c.prize !== undefined || c.description !== undefined) {
        if (!t.official) throw new HttpError(409, 'not_official');
        // The pot keeps the buy-ins; only the house's part changes.
        if (c.prize !== undefined) await tx`update tournaments set pot = pot - prize + ${c.prize}, prize = ${c.prize} where id = ${t.id}`;
        if (c.description !== undefined) await tx`update tournaments set description = ${c.description || null} where id = ${t.id}`;
      }
      if (c.startsAt !== undefined) {
        const at = c.startsAt === null ? null : new Date(c.startsAt);
        await tx`update tournaments set starts_at = ${at}, reminded = 0 where id = ${t.id}`;
        await tx`delete from tournament_checkins where tournament_id = ${t.id}`;
        if (at && checkInOpen(at.getTime(), Date.now()) && (await signedUp(tx, t.id)).includes(uid)) {
          await tx`insert into tournament_checkins (tournament_id, user_id) values (${t.id}, ${uid}) on conflict do nothing`;
        }
      }
      return { ok: true };
    });
  },

  /**
   * Fix a first-round match before the start. An admin pairs any two entries (replacing
   * whatever either was in). A player, when the host let players pick, pairs their own entry
   * with another still free (in 2v2, full pairs only) while the bracket still has room.
   */
  async tournament_pair(uid: string, { id, a, b }: { id: string; a: string; b: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      const entries = await entriesOf(tx, t.id);
      const ea = entries.find((e) => e.id === a);
      const eb = entries.find((e) => e.id === b);
      if (!ea || !eb || a === b) throw new HttpError(404, 'team_not_found');
      if (await isAdmin(tx, uid)) {
        await tx`delete from tournament_pairs where tournament_id = ${t.id}
                 and (entry_a in (${a}, ${b}) or entry_b in (${a}, ${b}))`;
        await tx`insert into tournament_pairs (tournament_id, entry_a, entry_b, set_by) values (${t.id}, ${a}, ${b}, 'admin')`;
        return { ok: true };
      }
      if (t.seeding !== 'pick') throw new HttpError(409, 'pick_closed');
      const mine = entries.find((e) => e.player1 === uid || e.player2 === uid);
      if (!mine || mine.id !== a) throw new HttpError(403, 'not_in_tournament');
      if (t.mode === '2v2' && (!ea.player2 || !eb.player2)) throw new HttpError(409, 'pick_needs_pair');
      const pairs = await tx<{ entry_a: string; entry_b: string }[]>`select entry_a, entry_b from tournament_pairs where tournament_id = ${t.id}`;
      if (pairs.some((x) => [x.entry_a, x.entry_b].some((e) => e === a || e === b))) throw new HttpError(409, 'pick_taken');
      // Solos in 2v2 pair up at the start: count the teams there will be.
      const teams = t.mode === '2v2' ? entries.filter((e) => e.player2).length + Math.floor(entries.filter((e) => !e.player2).length / 2) : entries.length;
      if (pairs.length >= teams - bracketSize(teams) / 2) throw new HttpError(409, 'pick_full');
      await tx`insert into tournament_pairs (tournament_id, entry_a, entry_b, set_by) values (${t.id}, ${a}, ${b}, 'player')`;
      return { ok: true };
    });
  },

  /** Undo a fixed match: an admin, any; a player, a pick their own entry is in. */
  async tournament_unpair(uid: string, { id, entryId }: { id: string; entryId: string }) {
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      if (await isAdmin(tx, uid)) {
        await tx`delete from tournament_pairs where tournament_id = ${t.id} and ${entryId} in (entry_a, entry_b)`;
        return { ok: true };
      }
      const mine = (await entriesOf(tx, t.id)).find((e) => e.player1 === uid || e.player2 === uid);
      if (!mine || mine.id !== entryId) throw new HttpError(403, 'not_in_tournament');
      await tx`delete from tournament_pairs where tournament_id = ${t.id} and set_by = 'player' and ${entryId} in (entry_a, entry_b)`;
      return { ok: true };
    });
  },

  /** Admin: every tournament, the ones still to be played first. */
  async admin_tournaments(uid: string) {
    await adminOnly(uid);
    return await sql`
      select t.id, t.code, t.name, t.mode, t.size, t.phase, t.seeding, t.starts_at, t.created_at, t.buy_in, h.display_name as host,
        (select count(*)::int from tournament_entries e where e.tournament_id = t.id) as entries,
        t.visibility, t.official, t.featured, t.prize::int as prize, t.announced_at
      from tournaments t join profiles h on h.id = t.host
      order by (t.phase = 'lobby') desc, (t.phase = 'playing') desc, t.created_at desc
      limit 60`;
  },

  /** Admin: show a public tournament on the home screen (while it takes sign-ups), or take it off. */
  async admin_tournament_feature(uid: string, { id, featured }: { id: string; featured: boolean }) {
    await adminOnly(uid);
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (featured && t.visibility !== 'public') throw new HttpError(409, 'tournament_private');
      if (featured && t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      await tx`update tournaments set featured = ${!!featured} where id = ${t.id}`;
      return { ok: true };
    });
  },

  /**
   * Admin: "Avisar a todos" — buzz everyone with notifications on (not already signed up) about a
   * public tournament still taking sign-ups. Once per tournament. It arrives as an invite from
   * Capicúa; tapping it opens the tournament's details.
   */
  async admin_tournament_announce(uid: string, { id }: { id: string }) {
    await adminOnly(uid);
    return await sql.begin(async (tx) => {
      const t = await lockTournament(tx, id);
      if (t.visibility !== 'public') throw new HttpError(409, 'tournament_private');
      if (t.phase !== 'lobby' || (t.starts_at && t.starts_at.getTime() <= Date.now())) throw new HttpError(409, 'tournament_started');
      if (t.announced_at) throw new HttpError(409, 'already_announced');
      await tx`update tournaments set announced_at = now() where id = ${t.id}`;
      const payload = {
        kind: 'invite', invite: t.id,
        details: { kind: 'tournament', from: 'Capicúa', mode: t.mode, stake: t.buy_in, code: t.code, name: t.name },
      };
      // One row per person buzzed (notify_push queues the request; it never fails the caller).
      const sent = await tx`
        select s.user_id, notify_push(s.user_id, ${tx.json(payload as never)}) as queued
        from (select distinct user_id from push_subscriptions) s
        where not exists (select 1 from tournament_entries e where e.tournament_id = ${t.id} and s.user_id in (e.player1, e.player2))`;
      return { ok: true, sent: sent.length };
    });
  },

  /**
   * Called by anyone watching the bracket: no-shows forfeit when their Ready
   * clock runs out, games everyone walked away from get played out, and a
   * table an admin closed mid-match is opened again.
   */
  async tournament_tick(uid: string, { id }: { id: string }) {
    const [member] = await sql`
      select 1 from tournaments t where t.id = ${id} and (t.host = ${uid}
        or exists (select 1 from tournament_entries e where e.tournament_id = t.id and ${uid} in (e.player1, e.player2)))`;
    if (!member) throw new HttpError(403, 'not_in_tournament');
    await tickTournament(id);
    return { ok: true };
  },

  // --- shop ---

  async buy_chips(uid: string, { pack }: { pack: string }) {
    await sql.begin(async (tx) => {
      await noGuests(tx, uid);
      await notBanned(tx, uid);
    });
    try {
      return await createCheckout(sql, uid, pack);
    } catch (e) {
      if (e instanceof ShopError) throw new HttpError(e.status, e.code);
      throw e;
    }
  },

  // --- admin ---

  async am_i_admin(uid: string) {
    return { admin: await isAdmin(sql, uid) };
  },

  async admin_stats(uid: string) {
    await adminOnly(uid);
    const [s] = await sql`
      select
        (select count(*) from profiles)::int as players,
        (select count(*) from auth.users where coalesce(is_anonymous, false))::int as guests,
        (select count(*) from profiles where created_at >= current_date)::int as new_today,
        (select count(*) from games where created_at >= current_date)::int as games_today,
        (select count(*) from rooms where phase in ('ready', 'countdown', 'playing'))::int as live_tables,
        (select count(*) from queue)::int as in_queue,
        (select coalesce(sum(chips), 0) from profiles)::bigint as chips_total,
        (select coalesce(sum(amount) filter (where status in ('won', 'lost')), 0) - coalesce(sum(payout), 0) from side_bets)::bigint as house_side_bets,
        (select coalesce(sum(amount_cents), 0) from purchases where status = 'paid')::bigint as revenue_cents,
        (select coalesce(sum(amount_cents), 0) from purchases where status = 'paid' and paid_at >= current_date)::bigint as revenue_today_cents,
        (select count(*) from chip_ledger where reason = 'chest' and created_at >= current_date)::int as chests_today`;
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
  },

  async admin_users(uid: string, { q = '' }: { q?: string }) {
    await adminOnly(uid);
    const like = `%${String(q).trim()}%`;
    return await sql`
      select p.id, p.display_name, p.chips::bigint as chips, p.xp, p.games, p.wins, p.created_at, p.banned_until, p.ban_reason,
             u.email, coalesce(u.is_anonymous, false) as guest
      from profiles p join auth.users u on u.id = p.id
      where ${String(q).trim() === ''} or p.display_name ilike ${like} or u.email ilike ${like}
      order by p.created_at desc limit 50`;
  },

  async admin_user(uid: string, { id }: { id: string }) {
    await adminOnly(uid);
    const [user] = await sql`
      select p.*, u.email, coalesce(u.is_anonymous, false) as guest
      from profiles p join auth.users u on u.id = p.id where p.id = ${id}`;
    if (!user) throw new HttpError(404, 'no_user');
    const ledger = await sql`select delta, reason, note, created_at from chip_ledger where user_id = ${id} order by created_at desc limit 40`;
    const purchases = await sql`select pack, chips, amount_cents, status, created_at from purchases where user_id = ${id} order by created_at desc limit 20`;
    const [fair] = await sql`
      select
        (select count(*) from reports where reported = ${id})::int as reports,
        (select count(*) from reports where reported = ${id} and status = 'open')::int as open_reports,
        (select count(*) from table_alerts where user_id = ${id} and kind = 'left' and created_at > now() - interval '7 days')::int as left_7d,
        (select count(*) from table_alerts where user_id = ${id} and kind = 'screenshot' and created_at > now() - interval '7 days')::int as screenshots_7d,
        (select count(distinct h.game_id) from game_hands h join games g on g.id = h.game_id
          where h.user_id = ${id} and g.created_at > now() - interval '7 days')::int as games_7d`;
    const reports = await sql`
      select r.reason, r.note, r.status, r.created_at, p.display_name as reporter
      from reports r join profiles p on p.id = r.reporter
      where r.reported = ${id} order by r.created_at desc limit 10`;
    // Other accounts seen on the same network in the last 30 days (a second account, or someone at home).
    const sameNetwork = await sql`
      select distinct p.id, p.display_name
      from user_networks a join user_networks b on b.net = a.net and b.user_id <> a.user_id
      join profiles p on p.id = b.user_id
      where a.user_id = ${id} and same_network(a.user_id, b.user_id, 30)
      limit 20`;
    return { user, ledger, purchases, fair, reports, sameNetwork };
  },

  /**
   * Cheat alerts: open reports by player, pairs who play together suspiciously
   * (last 30 days), and who leaves the app or takes screenshots most (7 days).
   */
  async admin_fairplay(uid: string) {
    await adminOnly(uid);
    const reports = await sql`
      select r.reported as id, p.display_name as name, p.banned_until,
             count(*)::int as reports,
             count(distinct r.reporter)::int as reporters,
             count(distinct r.reporter) filter (where r.created_at > now() - interval '7 days')::int as reporters_7d,
             array_agg(distinct r.reason) as reasons,
             (array_agg(r.note order by r.created_at desc) filter (where r.note is not null))[1] as last_note,
             max(r.created_at) as last_at
      from reports r join profiles p on p.id = r.reported
      where r.status = 'open'
      group by r.reported, p.display_name, p.banned_until
      order by reporters_7d desc, reports desc, last_at desc
      limit 50`;
    const pairs = await sql<PairStats[]>`
      with g as (
        select id, kind, mode, stake, (public_state->>'winner')::int as winner
        from games
        where settled and created_at > now() - interval '30 days' and (stake > 0 or kind = 'public')
      ), together as (
        select a.user_id as u1, b.user_id as u2, g.kind, g.stake,
               case when g.mode = '2v2' then a.seat % 2 else a.seat end as side1,
               case when g.mode = '2v2' then b.seat % 2 else b.seat end as side2,
               g.winner
        from g
        join game_hands a on a.game_id = g.id and a.user_id is not null
        join game_hands b on b.game_id = g.id and b.user_id is not null and a.user_id < b.user_id
      ), stats as (
        select u1, u2,
               count(*)::int as games,
               count(*) filter (where kind = 'public')::int as public_games,
               count(*) filter (where side1 = side2)::int as partners,
               count(*) filter (where side1 = side2 and winner = side1)::int as partner_wins,
               count(*) filter (where side1 <> side2 and winner = side1)::int as wins1,
               count(*) filter (where side1 <> side2 and winner = side2)::int as wins2,
               coalesce(sum(stake), 0)::bigint as staked
        from together group by u1, u2
      )
      select s.*, x.display_name as name1, y.display_name as name2,
             exists (select 1 from friendships f where f.user_a = least(s.u1, s.u2) and f.user_b = greatest(s.u1, s.u2)) as friends,
             same_network(s.u1, s.u2, 30) as same_net
      from stats s join profiles x on x.id = s.u1 join profiles y on y.id = s.u2`;
    const suspects = pairs
      .map((p) => {
        const flags: string[] = [];
        if (p.same_net) flags.push('same_net');
        if (p.friends && p.public_games > 0) flags.push('friends');
        // With few players online the same faces meet a lot, so only a real habit counts.
        if (p.public_games >= 10) flags.push('often');
        if (p.partners >= 5 && p.partner_wins / p.partners >= 0.7) flags.push('partners_win');
        const vs = p.wins1 + p.wins2;
        if (vs >= 5 && Math.max(p.wins1, p.wins2) / vs >= 0.8) flags.push('lopsided');
        const score = (p.same_net ? 4 : 0) + (flags.includes('friends') ? 3 : 0) + (flags.includes('partners_win') ? 3 : 0)
          + (flags.includes('lopsided') ? 3 : 0) + Math.min(3, p.public_games / 10);
        return { ...p, staked: Number(p.staked), flags, score };
      })
      .filter((p) => p.flags.length > 0)
      .sort((a, b) => b.score - a.score || b.games - a.games)
      .slice(0, 30);
    const leavers = await sql`
      select t.user_id as id, p.display_name as name,
             count(*) filter (where t.kind = 'left')::int as left_app,
             count(*) filter (where t.kind = 'screenshot')::int as screenshots,
             coalesce(sum(t.seconds) filter (where t.kind = 'back'), 0)::int as seconds_away,
             (select count(distinct h.game_id) from game_hands h join games g on g.id = h.game_id
               where h.user_id = t.user_id and g.created_at > now() - interval '7 days')::int as games
      from table_alerts t join profiles p on p.id = t.user_id
      where t.created_at > now() - interval '7 days'
      group by t.user_id, p.display_name
      order by count(*) filter (where t.kind = 'screenshot') * 3 + count(*) filter (where t.kind = 'left') desc
      limit 30`;
    return { reports, suspects, leavers };
  },

  /** Close a player's open reports: 'dismissed' (nothing found) or 'actioned' (sanctioned). */
  async admin_report_resolve(uid: string, { userId, status }: { userId: string; status: 'dismissed' | 'actioned' }) {
    await adminOnly(uid);
    if (!['dismissed', 'actioned'].includes(status)) throw new HttpError(400, 'bad_status');
    const done = await sql`
      update reports set status = ${status}, reviewed_at = now()
      where reported = ${userId} and status = 'open' returning id`;
    return { closed: done.length };
  },

  /** Give or take chips (support, refunds, fixing mistakes). Always leaves a ledger line with a note. */
  async admin_adjust(uid: string, { userId, delta, note }: { userId: string; delta: number; note: string }) {
    await adminOnly(uid);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10_000_000) throw new HttpError(400, 'bad_amount');
    if (!String(note ?? '').trim()) throw new HttpError(400, 'note_required');
    return await sql.begin(async (tx) => {
      const [p] = await tx`update profiles set chips = chips + ${delta} where id = ${userId} and chips + ${delta} >= 0 returning chips`;
      if (!p) throw new HttpError(409, 'would_go_negative');
      await tx`insert into chip_ledger (user_id, delta, reason, note) values (${userId}, ${delta}, 'admin', ${`${note} (admin)`})`;
      return { chips: Number(p.chips) };
    });
  },

  /** hours: 0 = lift the ban, -1 = permanent. */
  async admin_ban(uid: string, { userId, hours, reason }: { userId: string; hours: number; reason?: string }) {
    await adminOnly(uid);
    if (!Number.isInteger(hours) || hours < -1) throw new HttpError(400, 'bad_hours');
    await sql`
      update profiles set
        banned_until = case when ${hours} = 0 then null when ${hours} = -1 then 'infinity'::timestamptz else now() + ${hours} * interval '1 hour' end,
        ban_reason = case when ${hours} = 0 then null else ${reason ?? null} end
      where id = ${userId}`;
    await sql`delete from queue where user_id = ${userId}`;
    return { ok: true };
  },

  async admin_tables(uid: string) {
    await adminOnly(uid);
    return await sql`
      select r.id, r.code, r.kind, r.mode, r.stake, r.phase, r.created_at,
             coalesce(json_agg(json_build_object('seat', s.seat, 'name', s.name, 'bot', s.is_bot, 'away', s.away) order by s.seat)
               filter (where s.seat is not null), '[]') as seats
      from rooms r left join room_seats s on s.room_id = r.id
      where r.phase <> 'finished'
      group by r.id order by r.created_at desc limit 100`;
  },

  /**
   * Sponsors with what they got: games their logo was on, players reached (unique),
   * views (players × games) and taps on "Patrocinado por…", all time and last 7 days.
   */
  async admin_sponsors(uid: string) {
    await adminOnly(uid);
    return await sql`
      select s.*,
        coalesce(g.games, 0)::int as games, coalesce(g.games_7d, 0)::int as games_7d,
        coalesce(p.players, 0)::int as players, coalesce(p.views, 0)::int as views, coalesce(p.views_7d, 0)::int as views_7d,
        coalesce(k.taps, 0)::int as taps, coalesce(k.tappers, 0)::int as tappers, coalesce(k.taps_7d, 0)::int as taps_7d
      from sponsors s
      left join lateral (
        select count(*) as games, count(*) filter (where created_at > now() - interval '7 days') as games_7d
        from games where sponsor_id = s.id
      ) g on true
      left join lateral (
        select count(distinct h.user_id) as players, count(h.user_id) as views,
               count(h.user_id) filter (where gm.created_at > now() - interval '7 days') as views_7d
        from games gm join game_hands h on h.game_id = gm.id
        where gm.sponsor_id = s.id and h.user_id is not null
      ) p on true
      left join lateral (
        select count(*) as taps, count(distinct user_id) as tappers,
               count(*) filter (where created_at > now() - interval '7 days') as taps_7d
        from sponsor_taps where sponsor_id = s.id
      ) k on true
      order by s.paused, s.created_at desc`;
  },

  /** Create or change a sponsor (the logo is already uploaded to the `sponsors` bucket). */
  async admin_sponsor_save(uid: string, { sponsor }: { sponsor: unknown }) {
    await adminOnly(uid);
    const s = validateSponsor((sponsor ?? {}) as never);
    if (!s) throw new HttpError(400, 'bad_settings');
    const row = {
      name: s.name, image_path: s.imagePath, tile_image_path: s.tileImagePath ?? null, link: s.link, style: s.style, opacity: s.opacity, size: s.size,
      salas: s.salas, custom: s.custom, tournaments: s.tournaments, tournament_codes: s.tournamentCodes,
      weight: s.weight, starts_at: s.startsAt, ends_at: s.endsAt, paused: s.paused, max_views: s.maxViews,
    };
    if (s.id) {
      const [u] = await sql`update sponsors set ${sql(row)} where id = ${s.id} returning id`;
      if (!u) throw new HttpError(404, 'not_found');
      return { id: u.id };
    }
    const [c] = await sql`insert into sponsors ${sql(row)} returning id`;
    return { id: c.id };
  },

  /** A new secret for the sponsor's report link: the old link stops working. */
  async admin_sponsor_new_link(uid: string, { id }: { id: string }) {
    await adminOnly(uid);
    const [s] = await sql`update sponsors set report_token = replace(gen_random_uuid()::text, '-', '') where id = ${id} returning report_token`;
    if (!s) throw new HttpError(404, 'not_found');
    return { token: s.report_token as string };
  },

  /** Remove a sponsor; games it was on just lose the link. Returns the logo paths so the panel can delete the files. */
  async admin_sponsor_delete(uid: string, { id }: { id: string }) {
    await adminOnly(uid);
    const [d] = await sql`delete from sponsors where id = ${id} returning image_path, tile_image_path`;
    return { imagePath: d?.image_path ?? null, tileImagePath: d?.tile_image_path ?? null };
  },

  /** Shut a table down: stakes and open side bets go back to everyone. */
  async admin_close_table(uid: string, { roomId }: { roomId: string }) {
    await adminOnly(uid);
    return await sql.begin(async (tx) => {
      const [room] = await tx<RoomDb[]>`select *, false as phase_due from rooms where id = ${roomId} for update`;
      if (!room) throw new HttpError(404, 'room_not_found');
      if (room.current_game && room.phase === 'playing') {
        const stakes = await tx`select user_id, -delta as amount from chip_ledger where game_id = ${room.current_game} and reason = 'stake'`;
        for (const st of stakes) {
          await tx`update profiles set chips = chips + ${st.amount} where id = ${st.user_id}`;
          await tx`insert into chip_ledger (user_id, delta, reason, game_id, note) values (${st.user_id}, ${st.amount}, 'refund', ${room.current_game}, 'mesa cerrada por admin')`;
        }
      }
      await refundSideBets(tx, room.id);
      await tx`delete from rooms where id = ${room.id}`;
      return { ok: true };
    });
  },

  async admin_ledger(uid: string, { userId }: { userId?: string }) {
    await adminOnly(uid);
    return await sql`
      select l.delta, l.reason, l.note, l.created_at, p.display_name
      from chip_ledger l join profiles p on p.id = l.user_id
      where ${!userId} or l.user_id = ${userId ?? null}
      order by l.created_at desc limit 100`;
  },

  async admin_purchases(uid: string) {
    await adminOnly(uid);
    return await sql`
      select pu.pack, pu.chips, pu.amount_cents, pu.status, pu.created_at, pu.paid_at, p.display_name, u.email
      from purchases pu join profiles p on p.id = pu.user_id join auth.users u on u.id = pu.user_id
      order by pu.created_at desc limit 100`;
  },

  // --- voice ---

  /** LiveKit access: whole table in custom rooms, teammates only in public 2v2, none in public 1v1/ffa. */
  /**
   * A LiveKit token for the table's voice. Players talk and listen; a spectator
   * (`watching` = the friend they came to see) only listens, in that friend's
   * voice room, as `spec-<id>` — each player's own app decides whether
   * spectators may hear them. Someone watching by link (`shared`) only listens
   * too, only at a private table and while their link is live, as an opaque
   * `air-…` identity: players' apps let it in only if they put their voice on
   * air (migration 20261012000000_share_voice).
   */
  async voice_token(uid: string, { roomId, watching, shared }: { roomId: string; watching?: string; shared?: boolean }) {
    const key = Deno.env.get('LIVEKIT_API_KEY');
    const secret = Deno.env.get('LIVEKIT_API_SECRET');
    const url = Deno.env.get('LIVEKIT_URL');
    if (!key || !secret || !url) throw new HttpError(501, 'voice_not_configured');
    const [row] = await sql`
      select r.code, r.kind, r.mode, s.seat, s.name from rooms r join room_seats s on s.room_id = r.id
      where r.id = ${roomId} and s.user_id = ${uid}`;
    if (!row && watching) {
      const [w] = await sql`
        select r.code, r.kind, r.mode, s.seat, (select display_name from profiles where id = ${uid}) as name
        from rooms r
        join room_spectators v on v.room_id = r.id and v.user_id = ${uid} and v.expires_at > now()
        join room_seats s on s.room_id = r.id and s.user_id = ${watching}
        where r.id = ${roomId}`;
      if (!w) throw new HttpError(403, 'not_in_room');
      const listenRoom = voiceRoomFor(w.kind, w.mode, w.code, w.seat);
      if (!listenRoom) throw new HttpError(403, 'voice_disabled');
      const at = new AccessToken(key, secret, { identity: `spec-${uid}`, name: w.name ?? '', ttl: '3h' });
      at.addGrant({ room: listenRoom, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
      return { url, token: await at.toJwt(), listenOnly: true };
    }
    if (!row && shared) {
      const [v] = await sql`
        select r.code, r.kind, r.mode, public.share_air_identity(v.link_id, v.user_id) as identity,
          jsonb_array_length(public.room_air_seats(r.id)) > 0 as on_air
        from room_share_viewers v
        join room_share_links l on l.id = v.link_id
        join rooms r on r.id = v.room_id
        where v.user_id = ${uid} and v.room_id = ${roomId} and public.share_link_live(l.id)
        order by l.created_at desc limit 1`;
      if (!v) throw new HttpError(403, 'not_in_room');
      // Public tables keep their voice to themselves; and nobody here has put theirs on air.
      if (v.kind !== 'custom' || !v.on_air) throw new HttpError(403, 'voice_disabled');
      const listenRoom = voiceRoomFor(v.kind, v.mode, v.code, 0);
      if (!listenRoom) throw new HttpError(403, 'voice_disabled');
      const at = new AccessToken(key, secret, { identity: v.identity, name: '', ttl: '1h' });
      at.addGrant({ room: listenRoom, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
      return { url, token: await at.toJwt(), listenOnly: true };
    }
    if (!row) throw new HttpError(403, 'not_in_room');
    const voiceRoom = voiceRoomFor(row.kind, row.mode, row.code, row.seat);
    if (!voiceRoom) throw new HttpError(403, 'voice_disabled');
    const at = new AccessToken(key, secret, { identity: uid, name: row.name, ttl: '3h' });
    at.addGrant({ room: voiceRoom, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
    return { url, token: await at.toJwt() };
  },

  // --- friends ---

  /** Ask someone to be friends (by their friend code or from their card). If they already asked me, we're friends. */
  async friend_request(uid: string, { code, userId }: { code?: string; userId?: string }) {
    return await sql.begin(async (tx) => {
      await notBanned(tx, uid);
      const [other] = userId
        ? await tx`select id, display_name from profiles where id = ${userId}`
        : await tx`select id, display_name from profiles where friend_code = ${String(code ?? '').trim().toUpperCase()}`;
      if (!other) throw new HttpError(404, 'friend_not_found');
      if (other.id === uid) throw new HttpError(400, 'friend_self');
      const [a, b] = pair(uid, other.id);
      const [existing] = await tx`select 1 from friendships where user_a = ${a} and user_b = ${b}`;
      if (!existing) {
        const [{ n }] = await tx`select count(*)::int as n from friendships where ${uid} in (user_a, user_b)`;
        if (n >= MAX_FRIENDS) throw new HttpError(409, 'friend_limit');
      }
      const [row] = await tx`
        insert into friendships (user_a, user_b, requested_by) values (${a}, ${b}, ${uid})
        on conflict (user_a, user_b) do update set
          status = case when friendships.requested_by <> excluded.requested_by then 'accepted' else friendships.status end,
          accepted_at = case when friendships.status = 'pending' and friendships.requested_by <> excluded.requested_by
                             then now() else friendships.accepted_at end
        returning status`;
      return { status: row.status as 'pending' | 'accepted', userId: other.id, name: other.display_name };
    });
  },

  /** Accept or turn down a request someone sent me. */
  async friend_respond(uid: string, { userId, accept }: { userId: string; accept: boolean }) {
    const [a, b] = pair(uid, userId);
    if (accept) {
      const [r] = await sql`
        update friendships set status = 'accepted', accepted_at = now()
        where user_a = ${a} and user_b = ${b} and status = 'pending' and requested_by <> ${uid} returning status`;
      if (!r) throw new HttpError(404, 'no_request');
      return { status: 'accepted' };
    }
    await sql`delete from friendships where user_a = ${a} and user_b = ${b} and status = 'pending' and requested_by <> ${uid}`;
    return { status: 'none' };
  },

  /** Unfriend, or take back a request I sent. Pending invites between us go too. */
  async friend_remove(uid: string, { userId }: { userId: string }) {
    const [a, b] = pair(uid, userId);
    await sql.begin(async (tx) => {
      await tx`delete from friendships where user_a = ${a} and user_b = ${b}`;
      await tx`delete from table_invites where (from_user = ${uid} and to_user = ${userId}) or (from_user = ${userId} and to_user = ${uid})`;
    });
    return { status: 'none' };
  },

  /** Send a private message to an accepted friend. */
  async direct_message_send(uid: string, { userId, text }: { userId: string; text: string }) {
    return await sql.begin(async (tx) => {
      await notBanned(tx, uid);
      const body = String(text ?? '').trim().replace(/\s+/g, ' ');
      if (!userId || userId === uid || body.length < 1 || body.length > 280 || /(https?:\/\/|www\.)/i.test(body)) {
        throw new HttpError(400, 'bad_message');
      }
      const [a, b] = pair(uid, userId);
      const [friend] = await tx`select 1 from friendships where user_a = ${a} and user_b = ${b} and status = 'accepted'`;
      if (!friend) throw new HttpError(403, 'not_friends');
      const [rate] = await tx`
        select
          exists(select 1 from direct_messages where sender_id = ${uid} and created_at > now() - interval '400 milliseconds') as too_soon,
          (select count(*)::int from direct_messages where sender_id = ${uid} and created_at > now() - interval '1 minute') as minute`;
      if (rate.too_soon || rate.minute >= 60) throw new HttpError(429, 'too_fast');
      const [message] = await tx`
        insert into direct_messages (sender_id, recipient_id, body) values (${uid}, ${userId}, ${body})
        returning id, sender_id, recipient_id, body, created_at, read_at`;
      return { message };
    });
  },

  /** Mark everything this friend sent me as read. */
  async direct_message_read(uid: string, { userId }: { userId: string }) {
    const rows = await sql`
      update direct_messages set read_at = now()
      where recipient_id = ${uid} and sender_id = ${userId} and read_at is null
      returning id`;
    return { read: rows.length };
  },

  /** Invite a friend to the private table or tournament I'm in. It pops up on their screen if they're online. */
  async friend_invite(uid: string, { userId, roomId, tournamentId }: { userId: string; roomId?: string; tournamentId?: string }) {
    const [a, b] = pair(uid, userId);
    const [f] = await sql`select status from friendships where user_a = ${a} and user_b = ${b}`;
    if (f?.status !== 'accepted') throw new HttpError(403, 'not_friends');
    const [from] = await sql`select display_name from profiles where id = ${uid}`;
    let details: Record<string, unknown>;
    if (roomId) {
      const [r] = await sql`
        select r.kind, r.mode, r.stake, r.code, r.phase, r.rules,
               (select count(*)::int from room_seats x where x.room_id = r.id) as seated
        from rooms r join room_seats s on s.room_id = r.id and s.user_id = ${uid} and not s.left_game
        where r.id = ${roomId}`;
      if (!r) throw new HttpError(403, 'not_in_room');
      if (r.kind !== 'custom' || r.phase !== 'lobby') throw new HttpError(409, 'game_in_progress');
      if (r.seated >= seatsOf(r.mode as Mode).length) throw new HttpError(409, 'room_full');
      details = { kind: 'room', from: from.display_name, mode: r.mode, stake: Number(r.stake), code: r.code, target: r.rules.target, ruleset: rulesetOf(r.rules) };
    } else if (tournamentId) {
      const [t] = await sql<TournamentDb[]>`select * from tournaments where id = ${tournamentId}`;
      const member = t && (t.host === uid || (await sql`
        select 1 from tournament_entries where tournament_id = ${t.id} and ${uid} in (player1, player2)`).length > 0);
      if (!t || !member) throw new HttpError(403, 'not_member');
      if (t.phase !== 'lobby') throw new HttpError(409, 'tournament_started');
      details = { kind: 'tournament', from: from.display_name, mode: t.mode, stake: t.buy_in, code: t.code, name: t.name };
    } else {
      throw new HttpError(400, 'bad_invite');
    }
    // One live invite per friend: sending again replaces it (and re-sending within 15 s does nothing).
    const [inv] = await sql`
      insert into table_invites (from_user, to_user, room_id, tournament_id, details)
      values (${uid}, ${userId}, ${roomId ?? null}, ${roomId ? null : tournamentId!}, ${sql.json(details as never)})
      on conflict (from_user, to_user) do update set
        room_id = excluded.room_id, tournament_id = excluded.tournament_id, details = excluded.details,
        status = 'sent', created_at = now(), expires_at = now() + interval '10 minutes'
      where table_invites.status <> 'sent' or table_invites.created_at < now() - interval '15 seconds'
         or table_invites.room_id is distinct from excluded.room_id
         or table_invites.tournament_id is distinct from excluded.tournament_id
      returning id`;
    return { sent: !!inv };
  },

  /** Say yes or no to an invite. Yes hands back where to go; the app then joins as usual. */
  async invite_respond(uid: string, { inviteId, accept }: { inviteId: string; accept: boolean }) {
    const [inv] = await sql`
      update table_invites set status = ${accept ? 'accepted' : 'declined'}
      where id = ${inviteId} and to_user = ${uid} and status = 'sent'
      returning room_id, tournament_id, expires_at < now() as expired`;
    if (!inv) throw new HttpError(404, 'invite_gone');
    if (accept && inv.expired) throw new HttpError(410, 'invite_gone');
    return { roomId: inv.room_id as string | null, tournamentId: inv.tournament_id as string | null };
  },

  // --- board looks ---

  /** Use a felt color or domino style I have (free, reached its level, or bought). */
  async equip_look(uid: string, { look }: { look: string }) {
    const l = lookById(String(look));
    if (!l) throw new HttpError(404, 'no_look');
    const [p] = await sql`select xp from profiles where id = ${uid}`;
    const owned = new Set((await sql`select look from owned_looks where user_id = ${uid}`).map((r) => r.look as string));
    if (!canUse(l, p.xp, owned)) throw new HttpError(403, 'look_locked');
    if (l.kind === 'felt') await sql`update profiles set felt = ${l.id} where id = ${uid}`;
    else await sql`update profiles set tiles = ${l.id} where id = ${uid}`;
    return { felt: l.kind === 'felt' ? l.id : undefined, tiles: l.kind === 'tiles' ? l.id : undefined };
  },

  /** Buy a premium look with chips (once, forever) and put it on. */
  async buy_look(uid: string, { look }: { look: string }) {
    const l = lookById(String(look));
    const price = l ? chipPrice(l) : null;
    if (!l || price === null) throw new HttpError(404, 'no_look');
    return await sql.begin(async (tx) => {
      await noGuests(tx, uid);
      await notBanned(tx, uid);
      const [had] = await tx`select 1 from owned_looks where user_id = ${uid} and look = ${l.id}`;
      if (!had) {
        const [ok] = await tx`update profiles set chips = chips - ${price} where id = ${uid} and chips >= ${price} returning chips`;
        if (!ok) throw new HttpError(409, 'balance_too_low');
        await tx`insert into chip_ledger (user_id, delta, reason, note) values (${uid}, ${-price}, 'look', ${l.id})`;
        await tx`insert into owned_looks (user_id, look) values (${uid}, ${l.id})`;
      }
      if (l.kind === 'felt') await tx`update profiles set felt = ${l.id} where id = ${uid}`;
      else await tx`update profiles set tiles = ${l.id} where id = ${uid}`;
      return { bought: !had, cost: had ? 0 : price };
    });
  },
};

const MAX_FRIENDS = 200;
/** Friendship rows store each pair once, smaller id first. */
const pair = (x: string, y: string): [string, string] => {
  const [p, q] = [x.toLowerCase(), String(y).toLowerCase()];
  return p < q ? [p, q] : [q, p];
};
// ---------- the tournament clock ----------

/**
 * Everything that's due in one tournament. Called by the server clock (pg_cron,
 * every 30 s) and by anyone watching the bracket, so it moves on even with every
 * app closed: check-in reminders and the scheduled start; then Ready deadlines
 * (with a 1-minute reminder), games everyone walked away from, and tables an
 * admin closed mid-match.
 */
export async function tickTournament(id: string) {
  const [t] = await sql<TournamentDb[]>`select * from tournaments where id = ${id}`;
  if (!t) return;
  if (t.phase === 'lobby' && t.starts_at) {
    await remindCheckIn(t).catch((e) => console.error('check-in reminder', e));
    if (new Date(t.starts_at).getTime() <= Date.now()) {
      await sql.begin(async (tx) => {
        const locked = await lockTournament(tx, id);
        if (locked.phase === 'lobby') await startTournament(tx, locked, 'clock');
      }).catch((e) => console.error('scheduled start', e));
    }
    return;
  }
  if (t.phase !== 'playing') return;
  await remindReady(id).catch((e) => console.error('ready reminder', e));
  const due = await sql`select id from rooms where tournament_id = ${id} and phase in ('ready', 'countdown') and phase_ends_at <= now()`;
  for (const { id: roomId } of due) {
    await sql.begin(async (tx) => {
      const { room, seats } = await lockRoom(tx, roomId);
      if (room.phase_due) await roomDeadline(tx, room, seats);
    }).catch((e) => console.error('tournament deadline', e));
  }
  const playing = await sql`select id from rooms where tournament_id = ${id} and phase = 'playing'`;
  for (const { id: roomId } of playing) {
    await sql.begin((tx) => playOutAbandoned(tx, roomId)).catch((e) => console.error('tournament play-out', e));
  }
  const lost = await sql<MatchDb[]>`select * from tournament_matches where tournament_id = ${id} and status in ('ready', 'playing') and room_id is null`;
  for (const m of lost) {
    await sql.begin(async (tx) => {
      const locked = await lockTournament(tx, id);
      const [cur] = await tx`select room_id, status from tournament_matches where id = ${m.id}`;
      if (!cur.room_id && cur.status !== 'done') await createMatchRoom(tx, locked, m);
    }).catch((e) => console.error('tournament reopen', e));
  }
}

/** Check-in reminders to whoever hasn't checked in: when it opens (15 min before) and a last call (3 min before). Once each. */
async function remindCheckIn(t: TournamentDb) {
  const start = new Date(t.starts_at!).getTime();
  const now = Date.now();
  const stage = now >= start - TOURNAMENT.lastCallMs ? 2 : checkInOpen(start, now) ? 1 : 0;
  if (stage <= t.reminded) return;
  const [claimed] = await sql`update tournaments set reminded = ${stage} where id = ${t.id} and reminded < ${stage} and phase = 'lobby' returning id`;
  if (!claimed) return;
  const missing = await sql<{ p: string }[]>`
    select p from tournament_entries e, unnest(array[e.player1, e.player2]) p
    where e.tournament_id = ${t.id} and p is not null
      and p not in (select user_id from tournament_checkins where tournament_id = ${t.id})`;
  const minutes = Math.max(1, Math.round((start - now) / 60_000));
  for (const { p } of missing) {
    await notify(sql, p, { kind: stage === 1 ? 'checkin_open' : 'checkin_last', name: t.name, code: t.code, minutes });
  }
}

/** One minute left on a Ready clock: buzz the players at that table who haven't pressed it. Once per match. */
async function remindReady(id: string) {
  const due = await sql<{ id: string; room_id: string }[]>`
    select id, room_id from tournament_matches
    where tournament_id = ${id} and status = 'ready' and not reminded and room_id is not null
      and ready_by <= now() + ${TOURNAMENT.readyReminderMs} * interval '1 millisecond'`;
  if (!due.length) return;
  const [t] = await sql`select name, code from tournaments where id = ${id}`;
  for (const m of due) {
    const [claimed] = await sql`update tournament_matches set reminded = true where id = ${m.id} and not reminded returning id`;
    if (!claimed) continue;
    const late = await sql`select user_id from room_seats where room_id = ${m.room_id} and not is_bot and not ready and user_id is not null`;
    for (const { user_id } of late) await notify(sql, user_id, { kind: 'match_last_call', name: t.name, code: t.code });
  }
}

/** The server clock's call (pg_cron → pg_net, with the secret from app_secrets): every tournament that might have something due. */
export async function cronTick(hook: string) {
  const [row] = await sql`select value from app_secrets where key = 'cron_hook'`;
  if (!row || hook !== row.value) throw new HttpError(403, 'forbidden');
  const list = await sql`
    select id from tournaments
    where phase = 'playing' or (phase = 'lobby' and starts_at < now() + interval '16 minutes')`;
  for (const { id } of list) await tickTournament(id).catch((e) => console.error('cron tick', id, e));
  return { ok: true, tournaments: list.length };
}

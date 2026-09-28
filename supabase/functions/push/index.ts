// Web Push sender. The database calls this (pg_net, see migration
// 20261001000200_push) when something should buzz a player's phone: a table
// invite, a friend request or answer, a tournament match that's ready. It
// writes the message in each device's language and sends it; subscriptions
// the push service says are gone get removed.
//
// GET (or ?action=init) returns the public key browsers subscribe with,
// creating the app's key pair the first time. POST only works with the
// secret the database sends.

import * as webpush from 'jsr:@negrel/webpush@0.3';
import type postgres from 'npm:postgres@3.4.5';
import { db } from '../game/db.ts';

const SITE = 'https://domino-apuestas.vercel.app';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let server: Promise<webpush.ApplicationServer> | null = null;

/** The app's push identity: made once, kept in app_secrets, shared by every copy of this function. */
function appServer(sql: postgres.Sql) {
  server ??= (async () => {
    let [row] = await sql`select value from app_secrets where key = 'vapid_keys'`;
    if (!row) {
      const fresh = await webpush.generateVapidKeys({ extractable: true });
      const probe = await webpush.ApplicationServer.new({ contactInformation: SITE, vapidKeys: fresh });
      const jwk = JSON.stringify(await webpush.exportVapidKeys(fresh));
      const pub = b64url(await probe.getVapidPublicKeyRaw());
      // Another copy may be doing the same right now: the first one in wins, everyone re-reads.
      await sql`insert into app_secrets (key, value) values ('vapid_keys', ${jwk}), ('vapid_public', ${pub}) on conflict (key) do nothing`;
      [row] = await sql`select value from app_secrets where key = 'vapid_keys'`;
    }
    const vapidKeys = await webpush.importVapidKeys(JSON.parse(row.value), { extractable: false });
    return await webpush.ApplicationServer.new({ contactInformation: SITE, vapidKeys });
  })().catch((e) => {
    server = null;
    throw e;
  });
  return server;
}

type Payload =
  | { kind: 'invite'; invite: string; details: { kind: 'room' | 'tournament'; from: string; mode: string; stake: number; code: string; name?: string } }
  | { kind: 'friend_request' | 'friend_accepted'; name: string }
  | { kind: 'match_ready' | 'match_last_call' | 'checkin_missed' | 'tournament_cancelled'; name: string; code: string }
  | { kind: 'checkin_open' | 'checkin_last'; name: string; code: string; minutes: number };

interface Message { title: string; body: string; url: string; tag: string; ttl: number }

const MODES: Record<string, { es: string; en: string }> = {
  '1v1': { es: '1 vs 1', en: '1 vs 1' },
  '2v2': { es: '2 vs 2', en: '2 vs 2' },
  ffa: { es: 'Todos contra todos', en: 'Free-for-all' },
};

/** What the notification says, in the device's language. */
export function message(p: Payload, lang: 'es' | 'en'): Message | null {
  const es = lang === 'es';
  switch (p.kind) {
    case 'invite': {
      const d = p.details;
      const mode = MODES[d.mode]?.[lang] ?? d.mode;
      const stake = d.stake ? `🪙 ${d.stake.toLocaleString('en-US')}` : es ? 'gratis' : 'free';
      if (d.kind === 'tournament') {
        return {
          title: es ? `${d.from} te invita a su torneo` : `${d.from} invites you to their tournament`,
          body: `🏆 ${d.name ?? ''} · ${mode} · ${stake}`,
          url: `/?torneo=${encodeURIComponent(d.code)}`, tag: 'invite', ttl: 600,
        };
      }
      return {
        title: es ? `${d.from} te invita a jugar` : `${d.from} invites you to play`,
        body: `${mode} · ${stake} · ${es ? 'Toca para unirte' : 'Tap to join'}`,
        url: `/?invitacion=${encodeURIComponent(p.invite)}`, tag: 'invite', ttl: 600,
      };
    }
    case 'friend_request':
      return {
        title: es ? `${p.name} quiere ser tu amigo` : `${p.name} wants to be your friend`,
        body: es ? 'Acéptalo en Mesas → Mis amigos' : 'Accept in Tables → My friends',
        url: '/?tab=tables', tag: 'friends', ttl: 86_400,
      };
    case 'friend_accepted':
      return {
        title: es ? `${p.name} aceptó tu solicitud` : `${p.name} accepted your request`,
        body: es ? 'Ya se pueden invitar a jugar' : 'You can invite each other to play now',
        url: '/?tab=tables', tag: 'friends', ttl: 86_400,
      };
    case 'match_ready':
      return {
        title: es ? '🏆 ¡Tu partida del torneo está lista!' : '🏆 Your tournament match is ready!',
        body: es ? `${p.name}: tienes 3 minutos para darle a Listo` : `${p.name}: you have 3 minutes to press Ready`,
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'match', ttl: 180,
      };
    case 'match_last_call':
      return {
        title: es ? '⏰ ¡Te queda 1 minuto!' : '⏰ 1 minute left!',
        body: es ? `${p.name}: dale a Listo o pierdes la partida` : `${p.name}: press Ready or you lose the match`,
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'match', ttl: 60,
      };
    case 'checkin_open':
      return {
        title: es ? `🏆 ${p.name} empieza en ${p.minutes} min` : `🏆 ${p.name} starts in ${p.minutes} min`,
        body: es ? 'Haz check-in para confirmar que vas a jugar. Si no, sales del torneo.' : "Check in to confirm you're playing, or you'll be taken off the list.",
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'checkin', ttl: 900,
      };
    case 'checkin_last':
      return {
        title: es ? '⏰ Últimos minutos para el check-in' : '⏰ Last minutes to check in',
        body: es ? `${p.name} empieza en ${p.minutes} min. Toca para confirmar que estás.` : `${p.name} starts in ${p.minutes} min. Tap to confirm you're in.`,
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'checkin', ttl: 180,
      };
    case 'checkin_missed':
      return {
        title: es ? `No hiciste check-in en ${p.name}` : `You didn't check in to ${p.name}`,
        body: es ? 'El torneo empezó sin ti. Te devolvimos la entrada.' : 'It started without you. Your buy-in is back.',
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'checkin', ttl: 3600,
      };
    case 'tournament_cancelled':
      return {
        title: es ? `${p.name} se canceló` : `${p.name} was called off`,
        body: es ? 'No llegó suficiente gente a tiempo. Te devolvimos la entrada.' : "Not enough people checked in. Your buy-in is back.",
        url: `/?torneo=${encodeURIComponent(p.code)}`, tag: 'checkin', ttl: 3600,
      };
    default:
      return null;
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sql = await db();
    if (req.method === 'GET' || new URL(req.url).searchParams.get('action') === 'init') {
      await appServer(sql);
      const [row] = await sql`select value from app_secrets where key = 'vapid_public'`;
      return json({ publicKey: row?.value ?? null });
    }

    const [hook] = await sql`select value from app_secrets where key = 'push_hook'`;
    if (!hook || req.headers.get('x-push-hook') !== hook.value) return json({ error: 'forbidden' }, 403);
    const { user, payload } = (await req.json()) as { user: string; payload: Payload };
    const devices = await sql<{ endpoint: string; p256dh: string; auth: string; lang: 'es' | 'en' }[]>`
      select endpoint, p256dh, auth, lang from push_subscriptions where user_id = ${user}`;
    if (!devices.length) return json({ sent: 0 });

    const app = await appServer(sql);
    let sent = 0;
    await Promise.all(devices.map(async (d) => {
      const msg = message(payload, d.lang);
      if (!msg) return;
      try {
        await app.subscribe({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })
          .pushTextMessage(JSON.stringify({ ...msg, icon: '/icons/icon-192.png' }), { ttl: msg.ttl, urgency: webpush.Urgency.High, topic: msg.tag });
        sent++;
      } catch (e) {
        const status = e instanceof webpush.PushMessageError ? e.response.status : 0;
        if (status === 404 || status === 410) await sql`delete from push_subscriptions where endpoint = ${d.endpoint}`;
        else console.error('push failed', status || (e as Error).message);
      }
    }));
    return json({ sent });
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
}

if (import.meta.main) Deno.serve(handle);

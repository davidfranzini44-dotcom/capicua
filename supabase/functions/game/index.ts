// The table referee. Every state change in Capicúa goes through here:
// rooms, seats, dealing, moves, bots, chips, and LiveKit voice tokens.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp } from '../_shared/fairplay.ts';
import { handlers, HttpError, ready, recordNetwork } from './handlers.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Actions that seat someone: note their network so chip tables keep people at one home apart. */
const NOTES_NETWORK = new Set(['queue_join', 'queue_status', 'join_room', 'create_custom', 'tournament_join']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function userId(req: Request): Promise<string> {
  const auth = req.headers.get('Authorization') ?? '';
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser(auth.replace(/^Bearer /, ''));
  if (error || !data.user) throw new HttpError(401, 'not_signed_in');
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const uid = await userId(req);
    const body = await req.json();
    const handler = handlers[body?.action as keyof typeof handlers];
    if (!handler) throw new HttpError(400, 'unknown_action');
    await ready();
    if (NOTES_NETWORK.has(body.action)) {
      await recordNetwork(uid, clientIp(req.headers)).catch((e) => console.error('recordNetwork', e));
    }
    return json(await handler(uid, body));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code }, e.status);
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});

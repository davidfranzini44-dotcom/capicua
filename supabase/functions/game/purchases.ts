// Chip purchases through Stripe Checkout. Chips only flow in: nothing here
// (or anywhere) turns chips back into money.

import type postgres from 'npm:postgres@3.4.5';
import { packFor } from '../_shared/table.ts';

export class ShopError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/** Starts a Stripe Checkout for a chip pack and records it as pending. */
export async function createCheckout(sql: postgres.Sql, uid: string, packId: string): Promise<{ url: string }> {
  const pack = packFor(packId);
  if (!pack) throw new ShopError(400, 'bad_pack');
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const site = Deno.env.get('SITE_URL');
  if (!key || !site) throw new ShopError(501, 'shop_not_configured');

  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${site}/?compra=ok`,
    cancel_url: `${site}/?compra=cancelada`,
    client_reference_id: uid,
    'metadata[user_id]': uid,
    'metadata[pack]': pack.id,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pack.cents),
    'line_items[0][price_data][product_data][name]': `${pack.chips.toLocaleString('en-US')} chelitos · Capicúa`,
    'line_items[0][price_data][product_data][description]': 'Fichas virtuales para jugar. No tienen valor monetario y no se cambian por dinero.',
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const session = await res.json();
  if (!res.ok || !session.url) {
    console.error('stripe checkout failed', session);
    throw new ShopError(502, 'stripe_error');
  }
  await sql`
    insert into purchases (user_id, pack, chips, amount_cents, stripe_session)
    values (${uid}, ${pack.id}, ${pack.chips}, ${pack.cents}, ${session.id})`;
  return { url: session.url };
}

/** Webhook: a Checkout was paid → credit the chips exactly once. */
export async function creditPurchase(sql: postgres.Sql, sessionId: string): Promise<{ credited: boolean }> {
  return await sql.begin(async (tx) => {
    const [p] = await tx`
      update purchases set status = 'paid', paid_at = now()
      where stripe_session = ${sessionId} and status = 'pending'
      returning user_id, chips`;
    if (!p) return { credited: false }; // unknown session, or already credited (Stripe retries)
    await tx`update profiles set chips = chips + ${p.chips} where id = ${p.user_id}`;
    await tx`insert into chip_ledger (user_id, delta, reason, note) values (${p.user_id}, ${p.chips}, 'purchase', ${sessionId})`;
    return { credited: true };
  });
}

/** Stripe-Signature check (v1 = HMAC-SHA256 of "timestamp.payload"), 5-minute tolerance. */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const ts = Number(parts.t);
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  if (!ts || sigs.length === 0 || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

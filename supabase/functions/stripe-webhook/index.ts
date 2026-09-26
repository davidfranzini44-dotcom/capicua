// Stripe → Capicúa: credits chips when a Checkout is paid.
// Deployed with verify_jwt = false (Stripe can't send a Supabase JWT);
// every request is authenticated by its Stripe signature instead.

import { db } from '../game/db.ts';
import { creditPurchase, verifyStripeSignature } from '../game/purchases.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('not configured', { status: 501 });
  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), secret))) {
    return new Response('bad signature', { status: 400 });
  }
  const event = JSON.parse(payload);
  const session = event.data?.object;
  const paid = event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded';
  if (paid && session?.payment_status === 'paid') {
    const r = await creditPurchase(await db(), session.id);
    console.log('checkout paid', session.id, r);
  }
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});

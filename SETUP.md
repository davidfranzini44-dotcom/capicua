# Capicúa — going online

Practice mode works with no setup (`npm run dev`). Online play, chips, chests,
the shop and the admin panel run on the accounts below.

## Live now
- Site: **https://domino-apuestas.vercel.app** (Vercel project `domino-apuestas`,
  team davidfranzini44-3789s-projects). Build variables `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` are saved on the project.
- Backend: Supabase project **capicua**, ref `acohdemaxyzembfztior`
  All migrations applied.
- Edge functions: `game` (JWT required) and `stripe-webhook` (no JWT — Stripe
  signs its requests instead).

Redeploy the site from this folder: `npx vercel deploy --prod`
Redeploy a function: `npx supabase functions deploy game --project-ref acohdemaxyzembfztior`
Push notifications: the `push` function (deploy with `--no-verify-jwt`; the database calls it through
pg_net). It makes the app's Web Push keys itself on first use (stored in `app_secrets`). On a new
Supabase project, update the `push_url` row in `app_secrets` to that project's functions URL.
(`stripe-webhook` also needs `--no-verify-jwt`; the Supabase CLI needs `npx supabase login` once.)

## Left to do (Supabase dashboard → project capicua)

1. **Authentication → Sign In / Providers**
   - Allow anonymous sign-ins: **on** (guests — free tables only)
   - Allow manual linking: **on** ("Guardar mi cuenta con Google")
   - Google: **on** (step 2)

   **Authentication → URL Configuration**
   - Site URL: `https://domino-apuestas.vercel.app`
   - Redirect URLs: `https://domino-apuestas.vercel.app/**` and `http://localhost:5180/**`

2. **Google login** — console.cloud.google.com → OAuth consent screen →
   Credentials → OAuth client (Web). Authorized redirect URI:
   `https://acohdemaxyzembfztior.supabase.co/auth/v1/callback`.
   Paste the client ID/secret into Supabase → Authentication → Google.

3. **Voice (LiveKit)** — cloud.livekit.io → project → keys. In Supabase →
   Edge Functions → Secrets add `LIVEKIT_URL` (wss://…), `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`. Until then the mic button says voice isn't available.

4. **Stripe (buying chips — one way only)**
   - Needs a Stripe account in a country Stripe supports for businesses.
   - Developers → Webhooks → add endpoint
     `https://acohdemaxyzembfztior.supabase.co/functions/v1/stripe-webhook`,
     events `checkout.session.completed` and
     `checkout.session.async_payment_succeeded` → copy its signing secret.
   - Supabase → Edge Functions → Secrets: `STRIPE_SECRET_KEY` (sk_…),
     `STRIPE_WEBHOOK_SECRET` (whsec_…), `SITE_URL` = `https://domino-apuestas.vercel.app`.

   Until these exist the shop says "La tienda abre pronto".
   Chips never convert back to money — there is no cash-out anywhere.

## Admin
Admins are the emails in table `admins` (added by hand, not in this repo).
Sign in with that Google account → ⚙️ Settings → "Panel de admin". Add more admins with
`insert into admins (email) values ('…');` in the SQL Editor.

## Starting over on a new Supabase project
SQL Editor → paste all of `supabase/SETUP_DATABASE.sql` (every migration in
order) → Run, add your admin with the insert above, then deploy both functions and repeat the steps above.

## How it fits together
- `supabase/functions/_shared/` — rules (1v1 robar, 2v2, free-for-all), bot,
  and all tunable numbers in `table.ts`: `SALAS`, `FRIENDLY`, `CHIPS`,
  `CHESTS`, `CHIP_PACKS`, `LEVEL_GAP_FOR_READY`, `LOBBY`, `TURN_SECONDS`,
  `SIDE_BET_ODDS`. The browser and the server run this exact code.
- `supabase/functions/game/` — the referee (matchmaking, lobbies, moves,
  bots, chips, side bets, chests, XP, admin, Stripe checkout).
- `supabase/functions/stripe-webhook/` — credits chips when Stripe says paid
  (signature-checked, credited exactly once).
- Hands and the 1v1 pile never reach other players' browsers.
- `.vercelignore` keeps server code, migrations and tests off Vercel.
- `/preview.html?s=…` (dev server only) shows screens with sample data:
  main, main-guest, main-out, main-offline, shop, chests, reveal,
  gameover-won, gameover-lost, countdown, ready, custom, table, away, profile.

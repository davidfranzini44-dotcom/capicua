# Capicúa live match sharing and TikTok broadcast — build brief for Claude

## Goal

Add a clear **Share match** button so a player can send a secure link to anyone who wants to watch the current match. Add a separate **TikTok broadcast view** that the player can open on a second phone and transmit with TikTok's Mobile Gaming / screen-share feature.

This is a build task, not another design exercise. Implement the complete flow, database security, realtime updates, responsive UI, Spanish and English text, and verification.

Repository: https://github.com/davidfranzini44-dotcom/capicua  
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`  
Visual reference: `qa/tiktok-broadcast-reference.png`

Read applicable `AGENTS.md` instructions and inspect `git status` before editing. At handoff, the checkout has separate untracked briefs named `CLAUDE_ARCADE_BUILD_BRIEF.md`, `CLAUDE_FOCUS_TABLE_BRIEF.md`, and `CLAUDE_SOUND_SETUP_BRIEF.md`. Preserve them and any later unrelated work.

## Product decision

Build two experiences from one match-scoped share link:

1. **Watch link** — a normal responsive spectator page where friends or the public can watch the board update live.
2. **Broadcast link** — a clean 9:16 presentation for a second phone. The user opens this view, starts TikTok LIVE with Mobile Gaming / screen share, then switches back to Capicúa so TikTok captures the board.

Do not add TikTok login, a TikTok SDK, or a fake TikTok interface. TikTok does not provide a normal public API that lets this web app start a LIVE directly. Capicúa supplies the broadcast-ready screen; TikTok supplies the comments, hearts, LIVE badge, microphone, and transmission.

## Existing code to reuse

- `src/ui/Watch.tsx` already implements friend watching. It calls `watch_friend`, obtains a room ID, subscribes through `useRoom`, and renders `TableView` without a private hand.
- `src/lib/useRoom.ts` reads `rooms`, `room_seats`, and `games.public_state`, subscribes to their Postgres Changes, and only fetches `game_hands` for the current user. A spectator must never receive another player's hand.
- `supabase/migrations/20261001000100_watch.sql` contains `room_spectators`, `is_room_viewer`, the friend-only `watch_friend` RPC, and viewer RLS policies.
- `supabase/migrations/20261008000000_spectators.sql` contains spectator presence, messages, rate limits, and voice-listening rules.
- `src/lib/watch.ts` and `src/ui/Spectators.tsx` provide the watcher list and spectator chat.
- `src/ui/Online.tsx` currently opens watch mode only from a friend row and parses `?sala=` invite links. It already has native-share and fallback patterns elsewhere in the file.
- `src/App.tsx` does not use a router; it dispatches special screens from query parameters. `src/lib/supabase.ts` preserves selected query parameters across authentication.
- `public/manifest.webmanifest` already supports a portrait standalone PWA, which helps the second-phone broadcast experience.

Refactor and reuse these paths. Do not create a second game-state implementation.

## User flow

### Player sharing a live match

Add a visible `Compartir partida` / `Share match` action while a user is seated in an active match. Put it in both places below so it is easy to find without crowding the board:

- near the existing spectator/watchers control;
- near the top of the table settings/actions sheet.

It opens a `ShareMatchSheet` with:

- title: `Compartir partida`;
- short reassurance: `Solo se comparte el tablero. Las fichas de cada jugador siguen privadas.`;
- primary action: `Compartir para mirar` using the Web Share API;
- fallback action: `Copiar enlace` with a clear success state;
- a `Transmitir en TikTok` section with a locally generated QR code, `Abrir vista de transmisión`, and `Copiar enlace de transmisión`;
- `Desactivar enlace` after a link has been created;
- four compact instructions:
  1. Keep playing on this phone.
  2. Scan the QR with a second phone.
  3. On that phone, start TikTok LIVE using Mobile Gaming / screen share.
  4. Return to Capicúa and open the broadcast full-screen.

Use the Web Share API as `navigator.share({ title, text, url })`. If unavailable or cancelled, keep the sheet open and offer clipboard copy. Generate the QR locally with a small maintained package such as `qrcode`; do not send the private link to a remote QR service.

### Viewer opening a shared link

Use a clean URL such as:

```text
https://capicua.app/?ver=<unguessable-token>
```

The app should silently create an anonymous Supabase session when needed, redeem the token, and open a shared spectator screen. Do not require the viewer to be the player's friend. A signed-in user keeps their existing identity.

The screen should show:

- the live board, score, hand number, turn arrow, names/avatars, remaining tile counts, placed-domino ownership markers, sponsor treatment, and match/hand results;
- an obvious `En vivo` state and reconnect state;
- the current watcher count;
- an `X`/exit control that leaves shared watch mode;
- the existing spectator chat for signed-in users if it can be kept safe and rate-limited;
- a read-only experience for anonymous users if chat/profile setup is incomplete.

It must never show any player's hand values, side bets, private game state, room invite code, private profile fields, or administrative controls. It must not let a viewer sit, play, pass, use powers, place a bet, change settings, or hear player voice by default.

### Second-phone broadcast

Use a route such as:

```text
https://capicua.app/?ver=<same-token>&modo=transmision
```

The same token may open the broadcast presentation. Do not create a weaker public route.

Before full-screen, show a small setup screen with:

- `Preparar transmisión`;
- `Activar pantalla completa`;
- `Mantener pantalla encendida` when the Screen Wake Lock API is available;
- a reminder to enable Do Not Disturb because TikTok screen share can expose notifications;
- an explanation that TikTok comments and hearts appear in TikTok, not inside Capicúa.

After starting, render a clean portrait canvas built for a 9:16 phone capture:

- Capicúa identity and match score at the top;
- the live domino board as the main focal point;
- all four seats and tile counts, with every hand face-down;
- clear turn arrow and partner relationship;
- placed-domino ownership markers;
- a restrained sponsor lower-third when the hand is sponsored;
- a finished/connection-lost state that does not reveal app controls.

Do **not** draw fake TikTok comments, hearts, navigation, or LIVE chrome. The reference image shows the intended hierarchy and safe area, but TikTok will add its own overlay. Keep important board information away from the lower 25% and the rightmost overlay area. The view must fill `100dvh`, prevent accidental scrolling, and scale cleanly from narrow phones through a 1080 × 1920 capture.

The broadcast page must not join voice or spectator chat in v1. The broadcaster can speak through TikTok's microphone. This avoids accidentally broadcasting private table voice.

## Secure link and database design

Create a new Supabase migration with the CLI; do not hand-pick a timestamp. If this repository's consolidated `supabase/SETUP_DATABASE.sql` must remain installable, update it after the migration.

Create a private `room_share_links` table or an equivalent model with at least:

- `id uuid primary key`;
- `room_id uuid not null`;
- `game_id uuid not null` so a link cannot silently follow players into a rematch;
- `created_by uuid not null`;
- `token_hash` storing only a SHA-256 digest of a cryptographically random token;
- `focus_seat int` for stable board orientation;
- `created_at`, `expires_at`, and nullable `revoked_at`;
- indexes needed for token lookup and active-link cleanup.

The URL token must have at least 128 bits of entropy. Never store it in logs, analytics, toast text, or plaintext database columns. It may live in component state long enough to share/copy it. Reopening after a reload may create another active link rather than storing the raw credential permanently.

Add narrowly scoped RPCs or an Edge Function:

1. `create_room_share_link(p_room uuid)`
   - requires `auth.uid()`;
   - permits only a currently seated human player in that room;
   - requires an active current game;
   - creates a token scoped to the current `game_id` and returns the raw token once;
   - expires within four hours and no later than the allowed final-results window.
2. `watch_shared_match(p_token text)`
   - requires a Supabase session; an anonymous account is acceptable;
   - hashes and validates the token using a constant-time-safe database comparison where available;
   - rejects expired, revoked, wrong-game, and non-active links;
   - grants only spectator access for that room and returns `room_id`, `game_id`, and `focus_seat`;
   - never returns private state.
3. `revoke_room_share_link(p_link uuid)`
   - requires the creator or another currently seated room member;
   - revokes access immediately and idempotently.

Reuse `room_spectators` only if its source can be tracked safely. Link-based access must remain tied to an active share-link row so revocation and expiration actually remove permission. Do not let a public-link redemption overwrite or weaken an existing friend-watcher grant. If extending `room_spectators`, model friend and share access explicitly rather than inferring it from a nullable field.

Enable RLS on every new table. Revoke default `PUBLIC` and `anon` execution where appropriate, then grant only the minimum roles needed. If using `SECURITY DEFINER`, set a fixed `search_path`, schema-qualify every table/function reference, validate `auth.uid()` inside the function, and grant execution explicitly.

Do not expose share-link rows directly to anonymous clients. Do not add public select policies to `game_hands`, `game_private`, `side_bets`, or whole profile records. A redeemed viewer may read only the public room/game projection needed by the existing spectator UI.

Scope access to the exact `game_id`. A rematch creates a new game and requires a new link. After the match finishes, keep the final result visible for two minutes, then make redemption fail and end existing share sessions. `Desactivar enlace` must end access sooner.

Use the existing Postgres Changes subscriptions for the room's public game state if the RLS model remains secure. Do not modify Supabase's `realtime` schema. Supabase has locked that schema against structural changes; only supported RLS policies on `realtime.messages` should be used if a future Broadcast migration is needed.

## Frontend integration

Suggested file boundaries; adjust after inspecting the code:

- `src/ui/ShareMatchSheet.tsx` — share sheet, Web Share, clipboard, QR, revoke.
- `src/ui/SharedWatch.tsx` — redeem token and reuse/refactor the current watch table.
- `src/ui/BroadcastView.tsx` — setup and presentation-only 9:16 screen.
- `src/lib/shareMatch.ts` — URL parsing/building and Supabase RPC wrappers.
- `src/ui/Watch.tsx` — expose/refactor the reusable spectator-table portion instead of duplicating it.
- `src/ui/RoomScreen.tsx` and/or `src/ui/TableView.tsx` — open the share sheet from an active player's table.
- `src/App.tsx` or `src/ui/Online.tsx` — dispatch `?ver=` and `modo=transmision` before the normal signed-in navigation.
- `src/lib/supabase.ts` — preserve `ver` and `modo` through any auth redirect without preserving unrelated parameters.
- `src/i18n.ts` — Spanish and English strings.
- `src/dev/preview.tsx` — deterministic preview scenarios.

Keep normal watch mode, player mode, practice, and sponsored-hand behavior working. Reuse `TableView` and board primitives, but give broadcast presentation explicit behavior rather than hiding random controls with global CSS. A prop such as `presentation="broadcast"` or a dedicated presentation wrapper is acceptable.

When a shared viewer redeems access, add them to the existing watcher count so players can see that people are watching. Label public-link viewers safely; do not expose an anonymous user's email or raw user ID. Leaving the view should call the existing stop-watching cleanup or its share-aware equivalent.

## Error and lifecycle states

Provide designed states for:

- invalid or malformed link;
- expired or revoked link;
- match has not started;
- match ended;
- host disconnected/reconnecting;
- viewer temporarily offline;
- anonymous-session creation failed;
- native share unavailable;
- clipboard permission denied;
- QR generation failed;
- wake lock or full-screen unavailable.

Use plain language such as `Este enlace ya no está disponible` and offer `Ir a Capicúa`. Never expose database errors, tokens, UUIDs, or stack traces.

## Preview scenarios

Add deterministic development previews so the user can inspect the work without starting a real room:

- `?s=share-match` — player share sheet with a QR and both link choices;
- `?s=shared-watch` — normal shared spectator view;
- `?s=broadcast-live` — clean 9:16 live broadcast canvas;
- `?s=share-ended` — final result and expiration countdown;
- `?s=share-invalid` — safe invalid-link state.

The supplied `qa/tiktok-broadcast-reference.png` is a concept reference. Match the Capicúa board, sponsor styling, and visual identity that exist in the app now; do not copy the reference's simulated TikTok chrome.

## Security and behavior tests

Add meaningful tests for the access boundary:

- a seated player can create a link for the current game;
- a stranger cannot create or revoke that link;
- an invalid, expired, revoked, or old-game token cannot be redeemed;
- the raw token is not stored in the database;
- an anonymous redeemed viewer can read the public board projection, seats, and score;
- that viewer cannot select `game_hands`, `game_private`, `side_bets`, another room, room invite codes, or private profile data;
- friend-watching still works and is not overwritten by share-link access;
- revocation and expiration remove link-derived permission;
- one shared link cannot carry into a rematch;
- URL parsing and auth-return preservation keep only the expected values;
- Web Share cancellation does not show a false error or revoke the link;
- clipboard fallback reports success/failure correctly.

Also verify manually:

- two real browser sessions: a player makes a move and both watch/broadcast views update without refresh;
- watcher count rises and falls correctly;
- normal share at about 320, 390, 768, and desktop widths;
- broadcast at 360 × 800, 390 × 844, and a 9:16 desktop viewport;
- Spanish and English, long names, four players, long chains, hand result, match result, sponsor and non-sponsor hands;
- iOS/Android browser fallbacks for full-screen and wake lock;
- reduced-motion behavior and keyboard/screen-reader labels for the share sheet.

Run the existing tests plus `npm.cmd run build` and `npm.cmd run lint`. Apply the new migration to a development Supabase project and run the RLS cases with distinct player, friend-viewer, anonymous-link-viewer, and stranger sessions. A mocked frontend test alone is not enough for this permission boundary.

## Acceptance criteria

- A seated player can tap `Compartir partida`, share or copy a watch link, and see linked viewers in the watcher count.
- Anyone with a valid current link can watch the live public board without becoming a friend and without seeing private hands.
- A second phone can open the broadcast link, enter a clean portrait presentation, stay awake where supported, and be screen-shared to TikTok.
- The same credential is revocable, expires, and cannot follow a rematch.
- TikTok UI is not imitated inside Capicúa, and TikTok is never given the private token through a third-party QR service.
- Friend watching, gameplay, sponsored-hand presentation, chat controls, and realtime reconnect behavior continue to work.
- Claude provides the user with working local preview URLs and states clearly what was committed, pushed, migrated, and deployed.


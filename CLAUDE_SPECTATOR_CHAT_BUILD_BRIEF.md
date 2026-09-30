# Capicúa spectator chat and player audience panel — build brief for Claude

## Goal

Build the approved spectator-chat experience into the real Capicúa match UI. Spectators should feel present at the table without chat, ads, or controls covering the domino chain. Players should be able to see what spectators are saying while preserving their hand and gameplay controls.

This is an implementation task, not another design exercise. Implement the complete responsive UI, existing realtime behavior, profile/friend interactions, sponsor behavior, Spanish and English strings, deterministic previews, and verification.

Repository: `https://github.com/davidfranzini44-dotcom/capicua`  
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`  
Approved visual direction: `C:\Users\Lissa\OneDrive\Escritorio\Capicua-Designs\spectator-player-chat-v2.png`

Read applicable `AGENTS.md` files and inspect `git status` before editing. The checkout contains other work and design briefs. Preserve all unrelated changes. Do not replace the current Focus Table, sponsored-hand work, live sharing, voice, or existing social system.

## Final product decisions

1. The spectator screen has a docked chat below the board. It is part of the normal layout and never floats over the domino chain.
2. The player screen has a compact, read-only preview of the latest spectator messages above the player's hand. Players can expand it to the existing spectator panel, hide it, and see an unread count while it is collapsed.
3. The match's existing player quick-chat and spectator chat remain distinct. Players read spectator chat but do not post into it. Spectators continue to post through `spectator_say`.
4. A spectator can tap a real message author's avatar or name to view that person's public profile and request them as a friend.
5. `Compartir` and `Salir de la mesa` are separate actions. Never use the share icon as an exit affordance or combine both actions into one menu item.
6. A spectator always sees the sponsor banner during a sponsored hand until they dismiss it with its own X. `Ver patrocinador` stays clickable for spectators. The sponsor action remains unavailable to active players until the end of the match, as already established elsewhere in the product.
7. A spectator must see the focused player's remaining count beside the focused seat and in the watch-status bar, for example `Robert · 4 fichas`. Never expose the values of those hidden fichas.

## Existing code to reuse

- `src/ui/Spectators.tsx` contains `SpectatorsSheet`, spectator message rendering, sending, unread tracking, player visibility preferences, and voice-listening controls.
- `src/lib/watch.ts` contains `useSpectatorChat`, `useWatcherList`, `useLinkWatchers`, and `allWatchers`. `SpectatorMessage` already includes the stable `user_id` needed for profile and friendship actions.
- `src/ui/Watch.tsx` renders friend watch mode and opens `SpectatorsSheet` from the current `Mensaje` button.
- `src/ui/SharedWatch.tsx` renders link-based watch mode through `SharedTableView`, including sharing, sponsor taps, watcher counts, chat, and anonymous/read-only handling.
- `src/ui/TableView.tsx` already renders the focused player's hidden count in `.watch-bar` from `view.handCounts[mySeat]`; keep this data boundary and make it more visually prominent.
- `src/ui/RoomScreen.tsx` already loads spectator messages for active players, tracks unread messages, and opens `SpectatorsSheet`. It also loads player stats and opens `ProfileCard` when a player seat is tapped.
- `src/ui/ProfileCard.tsx` already renders public player statistics and includes `AddFriendButton`.
- `src/ui/Friends.tsx` and `src/lib/social.ts` already implement friend states and requests. Reuse `AddFriendButton`; do not create another friendship API.
- `src/ui/AdminSponsors.tsx`, `src/lib/sponsor.ts`, `src/ui/TableView.tsx`, and the sponsor CSS in `src/ui/table.css` already define sponsor/logo behavior. Reuse the real sponsor asset and its light/dark treatment.
- `supabase/migrations/20261008000000_spectators.sql` and `20261011000000_live_share.sql` define message access, rate limiting, and link-viewer permissions. Preserve those access boundaries.

Do not create a second chat subscription, profile-card implementation, sponsor model, or friendship store.

## Shared layout rules

- Keep the scoreboard, seats, current-turn indicator, public domino chain, hidden tile counts, placed-domino ownership markers, timers, reconnect states, and results working.
- The board receives its own reserved space. Chat, sponsor content, and transient messages must stay outside the felt.
- Use a flex/grid height budget rather than absolute positioning for the board, sponsor, chat, and hand regions. Short screens may reduce the number of previewed messages before reducing tile size or hiding gameplay controls.
- Respect safe-area insets and `100dvh`. There must be no page-level horizontal scroll and no control may be hidden behind an iPhone home indicator.
- At approximately 320–360 px width, shorten labels where translations already provide a short version, but keep distinct icons and accessible labels for Share and Exit.
- Use the current Capicúa colors, type, borders, button shapes, tile styles, felt choices, and avatar rings. Do not import a new design system.

## Spectator screen

### Top actions: Share and Exit must be separate

Render two independent controls in the top table chrome:

- `Compartir` / `Share`: share-arrow icon, opens the existing `ShareMatchSheet` or native share flow already used by the watch screen.
- `Salir de la mesa` / `Leave table`: door/exit icon or X with this explicit accessible label, calls the existing watch cleanup and returns home.

They must not share one hit target. On normal phone widths place Exit at the upper left and Share at the upper right, with the score centered/below as the current layout allows. Each target must be at least 44 × 44 CSS px. Do not put Exit inside the Share sheet.

### Focused player count

The focused player's seat must display:

- their avatar and turn outline;
- their name;
- the localized count, for example `4 fichas` / `4 tiles`;
- a row of four small face-down tile backs when four remain.

Repeat the count in the compact status strip below the board: `Mirando a Robert · 4 fichas`. Use `view.handCounts[focus]`; never derive the count from private hand data and never render face values.

### Sponsor banner

During a sponsored hand, render the existing spectator sponsor card between the watch-status strip and the chat dock:

- actual sponsor image/logo, not a generic white circle;
- `Mano patrocinada` and sponsor name;
- `Ver patrocinador`, which calls the existing tracked sponsor action;
- a small, separate X at the banner's upper-right edge.

The sponsor CTA and X must be separate hit targets. Dismissing the sponsor hides only this banner and must not leave a blank gap. Store dismissal locally using a key scoped to `gameId + handNo + sponsorId`; a new sponsored hand may show its banner again. Do not revoke the sponsor link or affect other viewers.

If an image fails, show a styled fallback with the sponsor's initials/name on the dark brand surface. Never leave an empty white circle. Keep `object-fit: contain`, meaningful alt text, and the existing `on-dark` treatment for light logos.

### Docked chat

Replace the spectator's `Mensaje`-only discovery path with a docked `SpectatorChatDock` below the sponsor banner. Keep `SpectatorsSheet` as the expanded/details experience rather than deleting it.

Expanded dock:

- header `Chat de la mesa` / `Table chat`;
- watcher avatar stack and `24 mirando` using the real watcher count;
- collapse control with an accessible label;
- the newest two or three messages, depending on available height;
- each row has avatar, clickable author name, relative time, body, and optional reaction summary;
- quick reactions such as `🔥 Buena`, `👏 Bravo`, and `😮 ¡Uff!`;
- input `Comenta la partida…` and Send button for named, signed-in spectators;
- anonymous or unnamed link viewers can read, but see the existing sign-in/name requirement instead of a working input.

Collapsed dock:

- one compact row containing the chat icon, `Chat de la mesa`, the latest-message preview, and unread badge;
- does not leave a large empty panel;
- stays below the sponsor area and above the bottom safe area.

The message list itself may scroll. The board must not move under a chat overlay. Auto-scroll only when the user is already near the newest message; do not pull them away from an older message they are reading.

## Player screen

Add a compact `SpectatorChatPreview` between the board/sponsor attribution and the private hand dock.

- Header: `Público · {count}` / `Audience · {count}`.
- Show the latest two messages with avatar, clickable name, and a one-line body.
- `Ver chat` opens the existing `SpectatorsSheet` with the watcher list, complete message history, voice/listening information, player visibility settings, and existing Share action.
- A collapse/hide control reduces the preview to one row. New messages add an unread badge while collapsed.
- Keep the existing `showSpectatorMessages` preference. Turning it off collapses the preview and suppresses transient spectator-message toasts. It does not unsubscribe from watcher counts.
- Players cannot send messages into spectator chat from this preview or sheet.
- Do not replace the player's normal quick-chat button or canned table chat.
- The private hand remains fully visible and tappable. On short screens show one spectator message instead of shrinking legal tiles below the current usable size.

During an active sponsored match, the player may see a small non-interactive `Mano patrocinada por {name}` attribution in reserved space. Do not make `Ver patrocinador` clickable for a player until the match-end sponsor treatment already allows it.

## Tapping a chat author: profile and friend request

Make the avatar and display name of every real `SpectatorMessage` author a button. The whole message body must not be the target, to avoid accidental profile opens while scrolling.

When tapped:

1. Use `message.user_id` to load the public `PlayerStats` projection already used by `ProfileCard`/`usePlayerStats`.
2. Open the existing `ProfileCard` with avatar, level, record, tournaments, and public stats.
3. Let the existing `AddFriendButton` show the correct action:
   - `Agregar amigo` when there is no relationship;
   - `Solicitud pendiente` after sending;
   - `Aceptar solicitud` for an incoming request;
   - `Amigos` when already connected;
   - no add button for the current user's own message.
4. Keep profile closing independent from chat closing, and return to the same chat scroll position.

For an anonymous/read-only link viewer without a normal Capicúa profile, `Ver perfil` may still show public stats if policy permits, but requesting friendship must open the app's existing sign-in/name flow. Do not silently create a friend request from a disposable anonymous identity.

Do not make synthetic rows such as `21 por enlace`, deleted-user fallbacks, system events, or bot messages clickable. Never fetch or display email, auth metadata, raw UUIDs, private hands, or other private profile fields.

Batch public profile reads for the visible message authors and cache them using the existing stats hook. Do not issue one database request per rendered row.

## Quick reactions

The approved concept includes quick reactions. Implement them without allowing free-form spam:

- The quick-reaction buttons send a predefined spectator message/reaction through a narrowly scoped server operation with the same watcher eligibility, ban checks, and rate limits as `spectator_say`.
- Tapping an existing message's reaction adds/removes that user's reaction and shows an aggregate count. One user may contribute at most one copy of a given reaction per message.
- If this requires a new table, create it through a Supabase migration and update `supabase/SETUP_DATABASE.sql` so clean installs still work.
- Recommended fields: `message_id bigint`, `user_id uuid`, `emoji text`, `created_at timestamptz`, primary key `(message_id, user_id, emoji)`, with a strict allowlist for the three supported emoji.
- RLS must allow only current room participants and valid watchers/link viewers to read; only valid spectators may react. Use a security-definer RPC only with a fixed `search_path`, schema-qualified objects, `auth.uid()` checks, and explicit grants.
- Keep the current free-text rate limits. Add a short reaction throttle to prevent rapid tapping.

If reactions are deferred during implementation, the dock itself, profiles/friend requests, player preview, sponsor placement, count, and separate Share/Exit controls are still required. Do not replace reactions with fake nonfunctional counters.

## Component structure

Suggested boundaries; adjust after inspecting the current worktree:

- `src/ui/SpectatorChat.tsx`
  - shared `SpectatorChatDock`;
  - compact `SpectatorChatPreview`;
  - reusable `SpectatorMessageRow` with author/profile action;
  - profile loading and selected-author state, or accept those as props from the screen owner.
- `src/ui/Spectators.tsx`
  - keep the expanded sheet and current settings;
  - reuse the message row rather than maintaining two different visual/interaction rules.
- `src/lib/watch.ts`
  - continue owning message subscriptions and sending;
  - add reaction subscription/mutations only if reactions are implemented.
- `src/ui/Watch.tsx` and `src/ui/SharedWatch.tsx`
  - mount the dock;
  - provide the focused count, watcher count, share action, exit action, sponsor action, identity capability, and author profile behavior.
- `src/ui/RoomScreen.tsx`
  - mount the player preview;
  - reuse the stats/profile/friend flow already used for seated players;
  - avoid duplicate toasts when the preview is expanded.
- `src/ui/TableView.tsx`
  - expose stable layout slots/props if necessary for spectator status, sponsor, audience preview, and separate top actions;
  - keep game logic and private/public projections unchanged.
- `src/ui/table.css` and/or a focused chat stylesheet
  - responsive height budgets, dock states, message rows, safe areas, and touch targets.
- `src/i18n.ts`
  - all new Spanish and English copy.
- `src/dev/preview.tsx`
  - deterministic scenarios below.

Prefer explicit slots or composed children over global selectors that reposition unrelated buttons.

## Data and security boundaries

- Keep `room_messages` readable only by seated participants and authorized spectators/link viewers under the existing RLS model.
- Continue writing free-text only through `spectator_say`; active players must not gain permission to impersonate spectators.
- Profile taps use the public profile/stat projection only. Do not broaden `profiles` policies to expose private account data.
- Friendship changes must go through the existing `friend_request`/social flow and its current authorization checks.
- Anonymous link access remains read-only for chat until the user has a proper display name, matching the current `canWrite` behavior.
- A sponsor dismissal is client presentation state, not a database update.
- Do not leak the match share token through chat, profile queries, analytics, console output, or error text.

## Preview scenarios

Add deterministic previews so this can be reviewed without a live room:

- `?s=spectator-chat` — expanded spectator dock, Robert with 4 hidden fichas, no sponsor.
- `?s=spectator-chat-sponsored` — the same state with a real-looking iBearfix logo, clickable CTA, and dismiss X.
- `?s=spectator-chat-collapsed` — collapsed dock with unread count and sponsor dismissed.
- `?s=player-spectator-chat` — active player, two audience messages above a fully usable hand.
- `?s=player-spectator-chat-collapsed` — player preview collapsed with unread badge.
- `?s=chat-profile` — a message-author profile card open with the add-friend state.

Use fixtures only; do not depend on production Supabase data. Keep the existing sponsor preview fixtures and actual Capicúa visual system.

## Interaction and accessibility details

- Buttons for author names use semantic `<button>` elements and clear focus rings; do not use click handlers on plain text.
- Message timestamps use `<time>` with the full timestamp in `dateTime`/title and a localized short relative label visually.
- Announce new messages politely without reading the full history repeatedly.
- Preserve scroll position when a profile closes.
- The reaction count and emoji need an accessible label such as `8 reacciones Buena`.
- `Salir de la mesa`, `Compartir`, sponsor X, sponsor CTA, chat collapse, Send, and author buttons must all have distinct accessible names and at least 44 px primary touch targets where space permits.
- Respect reduced-motion settings; this task does not require floating hearts or board-covering effects.

## Acceptance criteria

- On the spectator screen, Robert visibly shows `4 fichas` and four face-down backs; no private value is visible.
- Share and Exit are separate, usable controls at the same time. Exiting runs the existing spectator cleanup; sharing does not exit.
- A sponsored spectator hand shows the correct sponsor image, name, CTA, and separate dismiss X. Clicking the CTA uses existing sponsor tracking. Clicking X removes the banner without leaving a gap.
- Spectator chat is visible below the board by default and can collapse. No message, emoji, or ad covers a domino.
- A signed-in spectator can send a message. An anonymous/unnamed viewer can read and is guided to sign in/name themselves before posting.
- A player sees the newest spectator messages above their private hand, can expand/collapse them, and never gets a spectator message composer.
- Tapping a real chat author opens the existing public profile card. The correct friend relationship action works from that card and updates without closing the match.
- The board, hand, voice, normal player chat, timers, sponsor lifecycle, sharing, forfeit/leave behavior, and reconnect states still work.
- The UI fits 320 × 568, 360 × 740, 390 × 844, 430 × 932, tablet, and desktop without clipped primary controls or page-level horizontal scrolling.
- Spanish and English layouts both fit. Long usernames truncate gracefully while the message remains readable.

## Verification before handoff

1. Run the production build and lint. Report existing warnings separately from new errors.
2. Check all deterministic previews at the phone sizes above and one desktop viewport.
3. Exercise a spectator flow: message arrives → unread updates → dock expands → send message → tap author → view profile → request friend → pending state → close profile → same chat scroll position.
4. Exercise sponsor behavior: banner loads a light logo correctly, CTA opens/tracks, X dismisses only the banner, a later sponsored hand can show again, and a broken logo uses the fallback instead of a white circle.
5. Exercise the player flow: play a legal tile while the preview is open, collapse it, receive a new message/unread badge, open the full sheet, and verify that the private hand remains visible and usable.
6. Verify Share and Exit independently in friend-watch and shared-link watch modes.
7. Confirm via network/database inspection that spectator responses never include another player's hand and profile taps request only public fields.
8. If reactions add a migration, add focused tests for eligibility, uniqueness, allowlisted emoji, removal, throttling, and RLS isolation.

Do not deploy or upload solely because the implementation is complete. Leave the finished changes locally with the preview routes available for review unless the user explicitly asks to upload.

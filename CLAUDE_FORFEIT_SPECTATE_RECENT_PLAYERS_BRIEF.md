# Capicúa forfeits, return-to-watch, and recent players — build brief for Claude

## Goal

Make forfeiting understandable, let a player return as a true spectator after forfeiting, and add a **Jugadores recientes / Recently played with** list where friend requests can be sent directly.

Repository: https://github.com/davidfranzini44-dotcom/capicua  
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`

Read applicable `AGENTS.md` files and inspect `git status` before editing. Preserve all unrelated work and the existing Claude briefs.

## What the game does now

The implementation currently behaves as follows:

- `LEAVER_XP` is `-30` in `supabase/functions/_shared/table.ts`.
- At settlement, `supabase/functions/game/handlers.ts` gives a player with `room_seats.left_game = true` exactly `-30 XP` instead of normal match XP. XP is clamped at zero.
- A normal Traditional result would otherwise award at least 20 XP, with bonuses for a win, Capicúas, Pollona, or second place. A leaver gets none of those result rewards; the single `-30` result replaces them.
- Entry stakes and tournament buy-ins are **chelitos/chips, not XP**. A mid-game forfeit does not refund the match stake. The stake remains in the pot.
- The current `payouts()` function still includes the forfeited human seat. If the server-controlled seat or team wins, the forfeiting player can currently receive that winning payout. Do not silently change this economic rule in this task. Make it explicit in the UI and flag it to the user if product wants a different rule later.
- Side bets remain in the game and settle normally.
- `join_room` rejects a player whose existing seat is marked `forfeited` while the room is playing.
- `watch_friend` is friend-only and rejects any user who already has a seat in that room, including a forfeited seat. This is why a forfeiter cannot return to watch.

## Required product behavior

### Clear forfeit confirmation

Replace the vague one-line forfeit warning with a confirmation that shows the exact consequences using the current room/game data:

- `−30 XP`;
- `🪙 {stake} chelitos no se devuelven y siguen en el premio` when the stake is above zero;
- `El bot terminará jugando tu asiento`;
- `No podrás volver a jugar esta partida`;
- `Sí podrás volver a verla como espectador`;
- `Quedarás libre para entrar a otra partida`.

For a free table, omit the chelitos line. For Arcade, do not claim a 30 XP loss because Arcade currently does not award or deduct Traditional XP at settlement. For a tournament, describe its buy-in and tournament consequences using the actual tournament rules rather than the public-table copy.

Use a destructive button labeled `Abandonar y perder 30 XP` for applicable Traditional games. Keep `Salir un momento` as the reversible option. The temporary-leave path must continue to reserve the seat, keep the player eligible to return, and prevent them from entering a second game.

Do not call the stake XP anywhere. Use `XP` only for progression and `chelitos`/the chip icon for the entry stake.

### Return as spectator after forfeiting

After a successful forfeit, show a small result screen rather than dropping immediately into the home screen:

- `Abandonaste la partida`;
- `El bot está terminando tu asiento`;
- primary action: `Ver como espectador`;
- secondary action: `Ir al inicio`.

The home/Mesas area must also show one compact `Partida abandonada en curso` card while that match is still active, with `Ver partida`. This lets the player return later. Remove the card when the match has finished; optionally keep the final result available in recent match history if such a screen already exists.

The spectator experience should reuse the existing watch table, watcher list, sponsor display, chat, reconnect behavior, and the shared-watch refactor from `CLAUDE_LIVE_SHARE_BUILD_BRIEF.md` if that work has already landed. Orient the board from the player's former seat.

Show a persistent non-blocking label such as `Estás mirando · el bot juega tu asiento`. All hands must be face-down. Disable every gameplay action. The forfeiter may leave and return to the spectator view until the game ends.

Treat the returning player as a spectator for voice: listen-only if the table permits spectators to listen, never publish microphone audio through the former player seat.

## Critical privacy fix

Do not implement this by routing the forfeiting user back through the ordinary player table with controls hidden.

Today `game_hands` has a select policy based only on `game_hands.user_id = auth.uid()`. Because the hand row keeps the original player's user ID, a forfeiter can still query the tiles that the server is now playing. Hiding those tiles in React is not sufficient.

Create a Supabase migration with the CLI and replace the hand policy with one that also verifies the matching `room_seats` row for the same game and seat is **not forfeited**. A temporary leaver with `forfeited = false` must retain access so they can return and play. A permanent forfeiter must lose database access to the hand immediately.

Use an RLS condition equivalent to:

```sql
game_hands.user_id = auth.uid()
and exists (
  select 1
  from games g
  join room_seats s on s.room_id = g.room_id
  where g.id = game_hands.game_id
    and s.seat = game_hands.seat
    and s.user_id = auth.uid()
    and not s.forfeited
)
```

Use schema-qualified names and the repository's normal secure-function conventions. Test the real RLS policy with distinct sessions.

Also audit `voice_token`, `useRoom`, `game_hands` Realtime subscriptions, move/pass/power endpoints, ready/next-hand endpoints, chat, and any cached hand state. A forfeiter must:

- receive no private-hand row after the forfeit transaction commits;
- have any previously rendered/cached hand cleared immediately;
- receive only the public game projection afterward;
- never obtain a publish-capable player voice token;
- never submit a move, pass, draw, power, ready, or next-hand action;
- never regain player access by refreshing, opening another tab, or calling an RPC directly.

Add a narrowly scoped server action such as `watch_forfeited_match({ roomId })` or an RPC equivalent. It must validate `auth.uid()` owns a seat in that room with `forfeited = true`, verify the requested room is still on the same game, and return only the room/game/focus-seat information needed to start spectator mode. It must not weaken the existing friend-watch rules.

If spectator presence is stored in `room_spectators`, keep the forfeited seat record for game history but add a separate spectator grant safely. Ensure stop-watching removes only the spectator presence and does not alter the recorded seat or settlement.

## Recently played with

Add a `Jugadores recientes` section under Amigos. It should include human players from completed online matches, whether they were teammates or opponents.

Show up to 20 unique players from the last 30 days, ordered by the most recent shared match. Each row contains:

- avatar;
- display name;
- level;
- `Jugaste hoy`, `Jugaste ayer`, or a short localized date;
- optional `N partidas juntos` when greater than one;
- the correct relationship action: `Agregar`, `Solicitud enviada`, `Aceptar`, or `Amigos`.

Tapping the player opens the existing `ProfileCard`. `Agregar` must use the existing `friend_request({ userId })` flow. Incoming requests can be accepted from the row. Pending/friend state must update without a page refresh.

Also show a compact `Jugaste con` row on the match-result screen so adding someone is easy at the moment the match ends. Do not interrupt the result animation or sponsor card; place recent-player actions below the main result and above the exit/rematch actions.

Exclude:

- the current user;
- bots and seats without a user ID;
- deleted profiles;
- duplicate people across multiple matches;
- practice games;
- matches that never started or were cancelled.

A forfeited match still counts as recently played for everyone who actually occupied a human seat. Do not reveal hands, room codes, stakes, private settings, or the identities of unrelated players through this API.

### Data access

Prefer a server-side `recent_players` RPC or Edge Function that derives the list from settled `games` plus `game_hands`/recorded seats. This avoids adding a second event table unless query performance requires one. Return only the minimal fields needed by the UI:

```ts
{
  id: string;
  displayName: string;
  avatarUrl: string | null;
  xp: number;
  lastPlayedAt: string;
  gamesTogether: number;
}
```

The function must require `auth.uid()`, begin from games in which that user actually had a human seat, limit the time window and result count server-side, and use a fixed `search_path` if it is `SECURITY DEFINER`. Revoke default execution and grant only the intended authenticated role.

Use the existing `friendships` table to calculate relationship state on the client or return it from a separate authorized query. Do not create duplicate friendship rows or bypass the existing maximum-friends and request rules.

Add indexes only after checking the query plan. Likely candidates are `game_hands(user_id, game_id)` and the existing `games(created_at)` index, but verify rather than guessing.

## Suggested integration points

- `src/ui/TableView.tsx` — clearer forfeit sheet and dynamic stake/XP copy.
- `src/ui/RoomScreen.tsx` — post-forfeit choice and conversion to spectator mode.
- `src/ui/Watch.tsx` — refactor the reusable watch table to accept a room and focus seat without requiring a friend.
- `src/ui/Online.tsx` — abandoned-match card and spectator navigation.
- `src/lib/useRoom.ts` — clear private hand data as soon as forfeiture removes access.
- `src/lib/social.ts` — load recent players and reuse relationship actions.
- `src/ui/Friends.tsx` — `Jugadores recientes` section and add/accept states.
- `src/ui/ProfileCard.tsx` — reuse existing friend action patterns where possible.
- `src/i18n.ts` — complete Spanish and English copy.
- `supabase/functions/game/handlers.ts` — forfeit-watch and recent-player server actions, plus voice hardening.
- a new Supabase migration — secure `game_hands` RLS and any narrowly scoped helper functions/indexes.

If `CLAUDE_LIVE_SHARE_BUILD_BRIEF.md` is implemented at the same time, share one reusable spectator-table component and one access-mode model (`friend`, `shared-link`, `forfeited-player`). Do not duplicate board rendering or realtime subscriptions.

## Tests

Add backend and RLS tests proving:

- Traditional forfeit produces exactly `-30 XP`, clamped at zero, and no normal result XP;
- Arcade does not show or apply the Traditional 30-XP penalty;
- the stake is not refunded on forfeit and the existing payout behavior remains unchanged;
- a temporary leaver can still read their hand and return to play;
- immediately after permanent forfeit, that same session cannot select its `game_hands` row;
- refreshing or opening another client cannot restore hand access;
- a forfeiter can redeem only their own forfeited room as a spectator;
- the spectator receives public state and cannot call gameplay/ready/voice-publish actions;
- friend-watch and public shared-watch behavior still work;
- recent players include teammates and opponents from settled online games, deduplicate correctly, order by most recent, cap at 20, and exclude bots/practice/cancelled games;
- a friend request from a recent-player row follows existing pending/accept/limit behavior.

Verify manually with two browsers and at least one real Supabase development environment:

1. Start a staked Traditional 2v2 game.
2. Forfeit from one account.
3. Confirm the account loses hand access, opens spectator mode, and cannot transmit voice or act.
4. Finish the match and confirm the XP/stake result shown matches the ledger/profile changes.
5. Confirm all human participants appear under `Jugadores recientes` and can send/accept friend requests.
6. Repeat with a free game, Arcade, temporary leave/return, refresh, and a second tab.

Run the existing test suite, `npm.cmd run build`, and `npm.cmd run lint`. Update `supabase/SETUP_DATABASE.sql` if the repository still uses it as a consolidated setup path.

## Acceptance criteria

- The forfeit sheet distinguishes XP from chelitos and lists the exact consequences for the current match.
- A permanent forfeiter can return to the same live board only as a spectator.
- No client or direct database call lets that forfeiter see the hand the bot is playing or use player-only actions/voice.
- A temporary leaver retains the existing return-to-play behavior.
- Amigos includes useful, deduplicated recent human players with working add/accept friend actions.
- Match results provide a convenient way to add the people who just played.
- Existing friend watching, shared-link watching, gameplay settlement, sponsored-hand treatment, and reconnect behavior remain intact.


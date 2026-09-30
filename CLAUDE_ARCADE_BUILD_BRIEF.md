# Capicua Arcade — implementation brief for Claude

## Task

Build a complete first version of Capicua Arcade in this existing game. Keep Traditional available as its own experience. Arcade should feel exciting because players can save and use special moves at decisive moments. A doubles-only variant is not enough.

Repository: https://github.com/davidfranzini44-dotcom/capicua
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`
Existing board preview: `http://127.0.0.1:4173/preview.html?s=board-design`

This document is a handoff, not an implementation. The user selected the concept below. Detailed rules labeled as implementation defaults resolve gaps in that concept; use them for v1 and report any necessary deviations.

Read applicable AGENTS.md instructions and inspect the current checkout before editing. Preserve unrelated work. At handoff time there are existing edits in `src/dev/preview.tsx`, `src/i18n.ts`, `src/ui/TableView.tsx`, and `src/ui/table.css`, plus untracked `src/lib/sfx.ts`, `src/lib/tableFx.ts`, and `tests/tableFx.test.ts`. These belong to other ongoing work. Integrate carefully; do not reset or replace them.

## Selected concept and scope

- Home offers Traditional and Arcade.
- Arcade v1 is 2v2, with partners across the table.
- First team to win three hands wins the match.
- Four powers: Cambio, Doble golpe, Comodin, and Candado.
- Each player has TWO total power uses for the entire match, shared across all four choices. Not two uses per power or per hand.
- Players may repeat a power on a later turn, within that budget.
- Everyone has the same choices. No purchases, inventories, unlock requirements, energy meter, or random power assignments in v1.
- Deliver playable bot practice, private friend rooms, and a separate friendly Arcade matchmaking option. Reuse current room and reconnect flows.
- Implementation default: Arcade v1 is free, with no stakes, side bets, or tournament integration. Keep its results separate from Traditional statistics, missions, XP, and chest awards until explicit Arcade reward rules are designed.
- Traditional keeps its existing game types, rules, scoring, rooms, and rewards.

## Base rules — implementation defaults

1. Use the existing double-six set: 28 physical fichas, seven per player, no draw pile.
2. Retain current seating, turn direction, first-hand mandatory opener, and winner-opens-next-hand behavior.
3. No powers until the mandatory first placement of a hand is complete, including subsequent hands. This avoids modifying or exchanging the opener.
4. A normal legal play that empties the player's hand wins the hand immediately. Award exactly one team star.
5. No point target in Arcade. Capicua can still receive a celebration, but neither Capicua nor pase corrido grants extra stars or match points.
6. For a blocked hand, retain the existing lowest-pip and tie-to-mano winner rules. Award one star. Use original physical tile values for remaining-hand pip counts.
7. Two charges per player persist across hands, reset only for a new match/rematch, and are publicly visible.
8. Maximum one power activation per player's turn. A bonus placement is part of the same turn.
9. Each ordinary turn lasts 15 seconds. Choosing or using a power does not reset or pause the deadline. Extra placements from Doble golpe are committed atomically, so they do not create a second timer.
10. On timeout, use the existing fair automatic-play approach: play a legal ordinary move or pass if none exists. Never automatically spend a human player's power charge.
11. Cancelling a selection or submitting an invalid/rejected action costs no charge. Deduct only on successful authoritative execution.
12. Charge counts, stars, locks, current turn, and deadlines must survive refresh and reconnect.

## Exact power behavior — implementation defaults

### Cambio

Before playing, choose one ficha from your hand and one opponent. Exchange your chosen ficha for a uniformly random ficha from that opponent's hand. Both hands keep the same size. You may target either opponent, never your partner or yourself.

- The server chooses the incoming ficha and performs both transfers in a single transaction.
- Public feedback names the actor and target, but never reveals either ficha's values. Each involved player privately receives their updated hand; teammates and spectators do not.
- You then make your normal play, using the original remaining turn time. You may play the incoming ficha and may win with it.
- A swap is allowed with one ficha remaining; neither hand is empty while a hand is active.
- Clear stale public inference about missing numbers for both affected players, without revealing the exchanged values. Revisit bot deductions that rely on earlier passes.
- Never allow the client to choose the opponent's ficha or reroll a successful exchange through retries.

### Doble golpe

Choose a first legal placement, then a second legal placement on the resulting board. Preview both placements and confirm them together as one action.

- The second ficha must match normally; it does not need to be a double.
- Either end may be used for each placement, subject to an active Candado.
- Require at least three fichas at the start of the action. The second placement cannot empty your hand.
- Only allow activation if a legal two-placement sequence exists. Validate the entire sequence server-side before applying any part.
- One charge pays for both placements. Then the turn advances once.
- Do not resolve a blocked hand between the two placements.
- A cancelled or invalid sequence leaves the hand, board, charge count, and turn unchanged.

### Comodin

Choose a ficha, an open board end, and which half will connect. Change ONLY that connecting half to the number required by the chosen end, then place it. The outward-facing half retains its original number.

Example: an end shows 6 and you hold 2|4. Convert the connecting 2 into 6 and play an effective 6|4, leaving 4 exposed. You still used the original physical 2|4 ficha.

- Require at least two fichas in hand; this action cannot play your final ficha.
- The action replaces your ordinary placement and ends your turn.
- Require an actual value change; do not charge for a placement that changes nothing.
- Respect Candado: Comodin cannot use the locked end.
- Preserve the ficha's immutable physical identity and original values separately from its effective board values. Effective duplicates on the board are allowed; duplicating or losing physical fichas is not.
- Future legal moves, end labels, board rendering, and accessibility text use effective values. History also records the original ficha and the alteration.
- Visibly mark the altered half with a small persistent wildcard symbol; explain original/effective values on tap or in history.

### Candado

Combine your normal legal placement with a selection of the left or right end to lock for the next player's turn. Preview and confirm as one action. Apply the lock to the selected end of the resulting board.

- The next player may use only the other end, including for Comodin or both Doble golpe placements.
- A lock covers the entire next player's turn and expires when that turn ends, whether by play, pass, or timeout.
- Cambio remains available during a locked turn; it does not remove the lock.
- A locked player may set their own Candado using a legal ordinary placement. The old lock expires and the new lock applies to the following player.
- A lock follows the chosen board end, not a screen coordinate or a particular domino.
- When both ends have the same number, still treat left/right as distinct choices. The existing legal-move deduplication must not accidentally hide the unlocked end.
- Disable Candado on a move that would empty your hand; the hand would already be over.
- Show a small lock beside the affected board end and its expiry beside the affected player's status. Never place an overlay across the fichas.

## Passing and blocked hands

The current engine assumes a player with no ordinary placement must pass and can declare a tranque when no physical tile matches. Powers invalidate those assumptions.

- If an ordinary placement exists, passing is not allowed.
- If no ordinary placement exists but an unused power can produce an action, give the player the remaining turn time to use it or explicitly pass. Do not auto-pass before they can choose.
- If neither an ordinary play nor a power action is available, an automatic pass may use the existing short delay.
- After using Cambio, recompute ordinary legality. If still unable to play, pass; one-power-per-turn prevents using a second power.
- Implementation default: end a hand as blocked after four consecutive unrestricted passes without a placement or a successful exchange. A placement or successful Cambio resets that counter.
- A pass during a locked turn expires the lock and resets the blocked-hand pass counter to zero; it does not count toward those four passes. This ensures the affected player gets another opportunity with both ends open. One locked pass followed by three ordinary passes must return the turn to that player, not end the hand.
- A successful exchange may reopen play even when no original move existed. Do not resolve a tranque before allowing the relevant power decision window.
- Charges are finite, so exchanges cannot postpone a blocked hand forever.
- Reset all turn-specific effects and pass counters when dealing the next hand.

## Screens and interaction

### Entry

- Add a clear Traditional / Arcade choice using the existing visual language.
- Traditional leads to existing choices. Arcade explains: `2 vs 2 · Gana 3 manos · 2 poderes por jugador`.
- Arcade offers `Practicar`, `Jugar en linea`, and `Mesa privada` through working flows.
- Show a brief first-use explanation that can be reopened from table settings. Keep explanations short and concrete.
- Spanish is the main UI language; provide English strings through the existing i18n system too.

### Arcade table

- Reuse the current improved board, ownership badges, player names, partner indicator, and turn arrow.
- Show three star slots for each team in the score area, plus a clear Arcade label.
- Display remaining charges near each player's portrait. Use a number and icon, not color alone.
- Place one compact `Poderes · 2` control beside or above the player's hand. Opening it reveals the four named choices and short descriptions. Avoid four large persistent buttons that crowd the fichas.
- Explain why a power is unavailable, such as `Necesitas 3 fichas`, `Ya usaste un poder este turno`, or `Sin poderes`.
- Provide clear select, preview, confirm, and cancel states. Confirm shows exactly what will happen; hiding or cancelling a picker never consumes a charge.
- Keep playable fichas easy to tap. Target at least 44px controls and provide keyboard/focus support.
- Keep messages such as `Cambio con Chelo`, `Doble golpe`, and `Extremo bloqueado` near player portraits or in a reserved status area. Clear transient messages by event ID and lifetime, including on reconnect and hand transitions.
- Never put `Tu turno`, `Pensando`, `Pase corrido`, or power announcements in the middle of the board. Previous overlays obscured fichas and sometimes stayed stuck.
- Use short, readable tile effects, stronger Arcade accent colors, and distinct power sounds. Reuse existing effects/sound work where suitable. Respect mute and reduced motion.
- End-of-hand screen shows the earned star and running match result. End-of-match screen supports rematch and exit; rematch resets every charge and effect.

## Repository integration notes

Inspect the current implementations before choosing exact file boundaries:

- `supabase/functions/_shared/domino.ts`: shared pure game rules, state, legal moves, passes, results. Keep browser and server consistent.
- `supabase/functions/_shared/bot.ts`: bot decisions. Extend with Arcade-aware decisions based only on the bot's own hand and public information.
- `supabase/functions/_shared/table.ts`: public-state projection, room settings, automatic actions and timing, payouts/rewards helpers.
- `supabase/functions/game/index.ts` and its handler modules: authenticated online actions, persistence, concurrency, and random exchanges.
- `src/lib/useRoom.ts`: online state, version updates, action requests and reconnect.
- `src/ui/MainScreen.tsx`, `src/ui/Online.tsx`, `src/ui/RoomScreen.tsx`: entry, matching, and rooms.
- `src/ui/PracticeTable.tsx`: offline bot gameplay; currently auto-passes humans with no ordinary legal move.
- `src/ui/TableView.tsx`, `src/ui/Board.tsx`, `src/ui/Tile.tsx`, `src/ui/table.css`: table, interactions and feedback. TableView currently reconstructs partial state for legal moves; make the required Arcade public metadata available without exposing other hands.
- `src/i18n.ts`: strings.
- `src/dev/preview.tsx`: deterministic preview fixtures.
- `tests/domino.test.ts`, `tests/table.test.ts`, existing board/UI helper tests: regression coverage.

Model Traditional/Arcade separately from the existing `1v1 | 2v2 | ffa` seating mode. Treat old persisted records without the new ruleset field as Traditional. Reject unsupported Arcade seating modes server-side. Keep power logic in reusable pure rules modules rather than UI-only branches.

Online requirements:

- Server validates current membership, actor, turn, state version, deadline, charges, target, legal placement sequence, and mode for every power action.
- Commit swaps and composite moves atomically under the existing game concurrency mechanism. Reject stale requests; use idempotent action IDs so retries cannot repeat spending, placements, random draws, or turn advancement.
- Realtime/public state, spectator views, logs, and power event payloads must not expose another player's hand or exchanged values. Update private hand projections for both exchange participants.
- Preserve physical tile identity through placement, swaps, wildcard rendering, history, and reconnect. Verify there are always exactly 28 distinct physical fichas across all locations.
- Add forward-only schema migrations as needed, including room/match discrimination and Arcade result storage. Inspect existing constraints, settlement triggers, mission counters, and reward paths so Arcade cannot accidentally award Traditional rewards.
- Arcade and Traditional must never be matched together. Carry the ruleset through invitations, room codes, refresh, history, and rematch.
- Practice and server play use the same transitions, availability checks, and result rules. Bots should demonstrate each power without reading opponents' private hands.

## Deferred features

Do not implement these in v1: Dobles Locos special hands, Mano Abierta, Numero Caliente, randomized hand modifiers, energy/combo systems, seasonal progression, purchasable powers, Arcade stakes, or Arcade tournaments.

They are future extensions. First deliver the four-power experience coherently.

## Build order and verification

1. Inspect repository instructions, current changes, engine invariants, auth/state projection, timing, and settlement paths.
2. Implement pure Arcade state and actions with deterministic tests; retain Traditional behavior.
3. Implement bot practice and complete table interactions using those rules.
4. Integrate online rooms, separate matching, authoritative actions, private state, and reconnect.
5. Add deterministic previews and verify mobile/desktop layouts and full matches.

Required automated coverage:

- Two charges per player per match, persistence across hands, reset on rematch, and maximum one power per turn.
- Atomic success/failure for swaps and two-placement sequences; duplicate/retried/stale requests cannot reroll or spend twice.
- Wildcard identity, orientation, effective matching, persistent visual metadata, and prohibition on going out with Comodin/Doble golpe.
- Lock expiry after play/pass/timeout, sequential locks, wildcard/double-play restrictions, and equal-number board ends.
- Power rescue opportunities before automatic passing; normal-play-required behavior; four unrestricted-pass tranques and reset after a swap or locked pass.
- Star scoring and match completion at three hands; no bonus points, accidental Traditional rewards, or cross-mode matching.
- Conservation of all 28 physical fichas across generated action sequences and complete matches.
- Privacy of exchanges and non-owner hands in public/spectator projections and events.
- Traditional regression suite remains green.

Use installed project commands: `npm.cmd exec -- vitest run`, `npm.cmd run lint`, and `npm.cmd run build`. Report pre-existing failures separately; do not hide them.

Required visual and end-to-end checks:

- Phone widths around 360px and 390px and a desktop viewport, including a crowded late-hand board.
- Every power's selection, cancellation, success, disabled state, and opponent feedback.
- A full practice match to three stars and rematch.
- An online multi-client match demonstrating all powers, refreshing the current player, spectator privacy, a timeout during power selection, and a stale competing request.
- No notices covering fichas, no stuck effects, no hidden power controls, and usable reduced-motion/muted behavior.
- Preview fixtures for the main Arcade table, each power, a locked turn, no charges, and match victory. Show the working local preview when finished.

## Handoff deliverables

Complete the implementation and verification, then report changed behavior, key files, test results, known limitations, and the local preview URL. Clearly distinguish what was tested locally from what was tested online. If external credentials prevent an online check, finish the runnable local implementation and document the exact remaining check.

Prepare migrations and function changes for deployment. This brief authorizes building locally; it does not itself request a production deployment, migration application, or GitHub push. Do not claim the feature is live without verifying deployment.

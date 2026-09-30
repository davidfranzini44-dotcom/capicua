# Capicua board design verification

final result: passed

## Visual target and evidence
- Selected option: second displayed image, La mesa de siempre.
- Source pixels: 853 x 1844, normalized to 390 x 844 for comparison.
- Implementation: http://127.0.0.1:4173/preview.html?s=board-design
- Screenshot/CSS viewport: 390 x 844, compared at 1:1 CSS dimensions. Browser screenshot output density normalized to one pixel per CSS pixel.
- State: 2v2, 42-28, hand 3, three tiles on board, seven in hand, 3-6 selected with both legal destinations visible.

## Findings and comparison history
1. P2: Initial grid tracks grew beyond the 390px viewport (401px content). Fixed with minmax(0, 1fr) columns and zero minimum widths. Verified scrollWidth equals viewport width.
2. P2: Header consumed more height than reference. Reduced wordmark size, score padding and topbar gap; final comparison confirms the intended board/hand hierarchy.
3. P2: A 44px end target overlapped a domino at 320px. Increased geometry spacing at the ends. Rechecked selected state at 320 x 568: targets separated from tiles, footer visible, scroll dimensions 320 x 568.
4. Development-only createRoot warning after hot replacement of the pre-existing preview gallery. Added HMR cleanup. Final fresh browser tab has no console errors.
5. User reported turn badge overlapping the top player tile count at 505 x 698. Replaced percentage positioning with a vertical stack and a 10px gap. Verified the gap and no horizontal overflow at 505 x 698, 320 x 568, 390 x 844, 844 x 390, and 1440 x 1024.

## Fidelity surfaces
- Typography: existing Rubik and Bungee preserved; compact ivory wordmark, gold/coral score hierarchy, readable turn and destination labels. Straight rather than arched wordmark is a P3 refinement.
- Layout rhythm: partner above, opponents on sides, self below; central board and separate hand; wood rail and green felt. Responsive desktop centers the table; landscape moves hand beside it. No controls clipped in inspected sizes.
- Colors: existing emerald/ivory/gold/coral tokens; selected tiles have both border and raised position. Invalid tiles remain visible; reduced motion disables animations.
- Imagery: generated felt, walnut, and fictional practice-bot portraits saved locally as WebP. Real online avatars remain supplied by the existing app. Existing SVG domino renderer is retained to guarantee correct, scalable pips; no image-based replacement of game logic.
- Copy: Spanish and English supported. Actual tile counts shown (6 for each opponent in the valid 28-tile fixture), unlike the mock's inconsistent 7. Untimed practice does not invent a countdown; live deadlines remain supported. Offline voice is explicitly unavailable.
- Interaction adaptation: visible numeric destinations replace decorative pip ghosts; native buttons provide keyboard access and 44 x 52px active targets. Decorative arrow trails are omitted so long domino chains stay unobscured. Select then place is consistent for one or two legal ends; automatic play is now opt-in and respects stored preferences.

## Verification
- Production TypeScript/Vite build: passed. Non-blocking >500KB chunk warning remains.
- Vitest: 5 files, 49 tests passed, including full-game board bounds coverage.
- Oxlint: completed with warnings in existing areas; no errors.
- Browser: 390 x 844 portrait, 320 x 568 small portrait, 844 x 390 landscape, and 1440 x 1024 desktop inspected.
- Large 15-tile 1v1 hand inspected: two rows, no viewport overflow, center opening control visible.
- Click selection, left placement, keyboard selection/right placement, invalid-end disabling, bot replies, quick-chat open/send/close, settings dialog and Escape dismissal verified on local offline games.
- Fresh final browser console: zero errors.
- Production online matchmaking, voice permission flow, and server round trips were not exercised. Existing integrations remain in place.

## Follow-up polish
- P3: an arched brand lockup could match the mock more closely.
- P3: distinct portraits for every practice bot; the mock and current implementation reuse the male portrait.

## Implementation checklist
- [x] Integrate selected board into shared TableView.
- [x] Preserve game engine, scoring, and existing modes.
- [x] Add accessible end selection and settings.
- [x] Fix responsive findings and compare again.
- [x] Verify build, tests and browser behavior.
- [x] Leave local playable preview open.
- [x] Publication requested by the user after the overlap fix.

---

# Sponsored hands verification

final result: passed

## Visual target and evidence
- Selected direction: sponsor-branded face-down fichas, a non-clickable hand-end credit, a clickable match-end card, and a spectator card that collapses to a sponsor chip.
- Reference: `C:\Users\Lissa\.codex\generated_images\01a0db38-8e41-7950-8b71-fb9491bccfb1\exec-eea7dc6b-05ee-4ef0-bdab-c9306c165b36.png`.
- Live preview: `http://127.0.0.1:5173/preview.html?s=watch-sponsor`.
- Implementation captures: `qa/sponsor-spectator-mobile.png`, `qa/sponsor-spectator-collapsed-mobile.png`, `qa/sponsor-between-hand-mobile.png`, and `qa/sponsor-match-end-mobile.png`.

## Findings and fixes
1. P1: Active players could reach the sponsor link from table settings during a live match. The settings credit is now static for players; the actionable link appears only on the final match result.
2. P1: Spectators needed continuous access without obscuring the board. The card now sits below the table, remains clickable during play, and its distinct red-and-gold close control collapses it to a smaller clickable chip.
3. P2: Desktop watch controls inherited absolute positioning and overlapped the new sponsor card. The spectator tool row now uses normal document flow at every breakpoint.
4. P2: A wide sponsor logo became unreadable on narrow ficha backs. The mark is rotated along the long edge of the ficha while retaining the sponsor's color/white treatment.

## Responsive and interaction checks
- 390 x 844 mobile: sponsor card bounds are x=14–376 and y=663–721; the table ends at y=584, so the card does not cover play. `scrollWidth` equals the 390px viewport.
- 360 x 640 short-phone layout: table, full sponsor card, spectator message, and all three controls remain visible without horizontal overflow.
- 1366 x 768 desktop: sponsor card and spectator controls remain separate in normal flow.
- Dismiss action: the full card collapses to a centered `Patrocinador ↗` chip; the sponsor remains reachable.
- Active-player settings: sponsor credit renders as text, not a button.
- Between hands: sponsor card is prominent and non-clickable.
- Match end: `Ver patrocinador ↗` is available beside the sponsor name.
- Console: zero errors and zero warnings in the inspected final preview.

## Verification
- Production TypeScript/Vite build: passed.
- Oxlint: passed with the repository's existing warnings and no errors.
- Git whitespace check: passed; Git reports the existing CRLF normalization notice for `src/ui/Sponsor.tsx`.

---

# Spectator chat and table controls verification

final result: passed

## Implemented behavior
- Spectators now have a docked table chat with the latest messages, viewer presence, quick reactions, a message field, unread state, and a compact collapsed state.
- Players can see a compact read-only audience feed under their hand and can open the complete spectator sheet.
- Tapping a chat author opens the existing player profile and friend control.
- Spectators get a labeled `Salir de la mesa` control in the top row. Share lives in the chat header, separate from leaving.
- `Escuchando` sits inside the thin `Mirando a {player} · {n} fichas` strip, matching the approved mock and removing the old bottom action row.
- The viewer count appears once in the audience/chat panel; the duplicate eye count beside `Mano` is suppressed whenever that panel is present.
- The focused spectator seat is now a structured card: avatar and name, a readable ficha count, a divider, and consistently spaced face-down fichas.
- A seated player's Share control lives in the `Público` panel header beside `Ver chat`; the top bar keeps only Exit. If the player hides the audience panel, Share falls back to the small felt-corner control and remains available in Settings.
- The focused player's face-down fichas and numeric count are visible while spectating.
- A spectator may dismiss a sponsor card with X for the current sponsored hand. A broken sponsor image uses branded initials instead of an empty white circle.

## Browser checks
- 390 x 844 spectator view: no horizontal or vertical overflow; `Salir de la mesa`, the 335px board, Robert's `4 fichas`, inline `Escuchando`, the complete sponsor card, Share in chat, two messages, reactions, composer, and status all fit together.
- Sponsor dismissal: the full sponsor card becomes a 24px `Patrocinado por {name} ↗` credit and stays dismissed for the current sponsor/hand key.
- Chat collapse: the dock becomes a single 50px bar with the latest message and unread badge, returning the extra height to the board.
- 360 x 640 short-phone view: no viewport overflow; the compact board remains 261px tall with the dismissed sponsor credit and the chat retains its latest message, reactions and composer.
- Profile access: tapping Papo opens the existing profile card and exposes the existing friendship action.
- 390 x 844 player view: sponsor credit and the two latest audience messages appear between the board and hand, matching the selected mock without covering the table, hand, status, voice, or table chat controls.
- 1366 x 768 desktop: board, focused-player count, chat, quick reactions, and message field remain centered; the table owns vertical scrolling when the expanded dock exceeds the viewport.

## Automated verification
- Production TypeScript/Vite build: passed.
- Vitest: 19 files, 235 tests passed.
- Oxlint: no errors; repository warnings remain.
- Git whitespace check: passed.


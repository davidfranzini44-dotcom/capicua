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


# Capicúa Focus Table — implementation brief for Claude

## Goal

Make the approved **Focus Table** look the default board in actual Capicúa games. The user has seen and accepted the interactive design preview. The goal is a clearer board on phones: opponents together at the top, the domino chain given one obvious play area, larger labeled placement targets, and the player's hand in a separate lower dock. Keep the familiar felt-and-wood character and the existing gameplay.

Repository: https://github.com/davidfranzini44-dotcom/capicua  
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`  
Approved prototype: `http://127.0.0.1:4173/preview.html?s=board-focus`  
Previous board for comparison: `http://127.0.0.1:4173/preview.html?s=board-design`

Read applicable `AGENTS.md` instructions and inspect `git status` before editing. At handoff, the Focus Table prototype is an **uncommitted local change** in `src/dev/BoardDesignPreview.tsx`, `src/dev/preview.tsx`, `src/ui/TableView.tsx`, and `src/ui/table.css`. Keep those changes. The untracked `CLAUDE_ARCADE_BUILD_BRIEF.md` and `CLAUDE_SOUND_SETUP_BRIEF.md` are separate work; leave them alone.

## What already exists

- `src/dev/preview.tsx` routes `s=board-focus` to `BoardDesignPreview focus`.
- `src/dev/BoardDesignPreview.tsx` passes `presentation="focus"` to `TableView` for a playable, deterministic 2v2 sample.
- `src/ui/TableView.tsx` accepts `presentation?: 'classic' | 'focus'`, but applies `.table-focus` **only when a caller explicitly passes `focus`**. Actual matches still render the previous board.
- `src/ui/table.css` contains the scoped `.table-focus` visuals. The current preview shows a compact phone scoreboard, all three other players in a top strip, a subtle oval around the domino chain, clearer end targets, a marked self seat, and a lower hand dock.
- The prototype was viewed on a 390 × 844 phone viewport and desktop. Selecting the 3–6 tile showed both large, labeled ends. `npm.cmd run build` and `npm.cmd run lint` exited successfully; lint had pre-existing warnings elsewhere.

## Implement it in real games

1. Make Focus Table the default presentation for `TableView` when no explicit presentation is passed. `PracticeTable.tsx`, `RoomScreen.tsx`, and `Watch.tsx` all use `TableView`; they must display the new design without duplicated CSS or changes to game rules. Keep `s=board-design` as the old comparison preview and `s=board-focus` as the Focus Table preview. A separate player-facing toggle is not part of this request.
2. Finish the layout for every mode that uses `TableView`: Traditional 2v2, 1v1 with a draw pile, free-for-all, Arcade with powers and charges, watching a friend, bot practice, and online rooms. The prototype mainly demonstrates 2v2; do not assume its top-strip spacing works unchanged in the other modes.
3. Keep gameplay controls and information working: score and hand number, whose turn it is, partner label, tile counts, board-end values, the selected tile, legal/illegal tile states, owner markers, timers, pass/draw actions, voice, chat, settings, powers, result sheets, and reconnect/away indicators. Keep transient text and effects away from the chain and placement targets.
4. Check the existing felt and domino cosmetics in `src/lib/look.ts` and `src/ui/LookPicker.tsx`. The Focus Table stage must respect every owned/selected felt tint and tile style. If the fixed green light in the prototype makes non-green felt look wrong, use a neutral or tint-aware highlight. Do not change unlock or purchase behavior.
5. Tune the responsive rules in `src/ui/table.css` so the chain remains legible and the hand remains tappable on narrow and short phones, landscape phones, tablets, and desktop. Keep active placement targets at least as easy to hit as the 54 px prototype targets, with a number and “Aquí/Here” label; do not convey playable state through color alone. Avoid clipping names, score labels, long hands, Arcade controls, or board ends.
6. Preserve the existing board geometry and rules. If the taller Focus Table stage makes a very short domino chain turn sooner than expected, adjust only the visual layout/available board area unless a board-layout change is shown safe for long chains and both orientations. Keep the placed-domino ownership markers and arrival animations.

## Verify before handing back

- Compare `board-design` and `board-focus`, then confirm real practice and online `TableView` instances render Focus Table by default. Confirm the old preview still renders the classic board.
- Exercise a 2v2 turn with a tile that can go on either end; select a tile, choose left and right in separate runs, and confirm the move lands correctly. Check autoplay of a single legal move, pass, a new hand, and the end-of-game sheet.
- Check 1v1/draw pile, free-for-all, Arcade powers, and watch mode for crowding or hidden controls. Test with a long chain and a large hand, not just the three-tile sample.
- Inspect at approximately 320, 390, and 768 px widths, a short phone height, phone landscape, and desktop. Test Spanish and English labels and at least one non-green felt and non-default tile style.
- Run `npm.cmd run build`, `npm.cmd run lint`, and relevant existing tests. Report any unrelated baseline warnings separately. Give the user a live local preview and state clearly whether the change was committed or uploaded.

Completion means **actual matches use Focus Table**, while the classic comparison preview remains available. The new look must improve the board's hierarchy without losing any mode-specific function.

# Claude handoff: upload the completed Capicúa work

The implementation is already complete in this checkout. Do not redesign it or recreate it from an older branch. Your job is to inspect, preserve, validate, commit, push, and deploy the current working tree.

## Repository

- Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`
- GitHub: `https://github.com/davidfranzini44-dotcom/capicua`
- Branch: `main`
- Starting commit: `2b36eae`
- At handoff time `main` matched `origin/main`; all newer work was uncommitted locally.

Read any applicable `AGENTS.md` first. Inspect `git status` and the complete diff before doing anything. Do not run `git reset`, `git checkout .`, `git clean`, or otherwise discard/replace the working tree. The modified and untracked files are intentional work from the current Capicúa design/build session.

## Final behavior already implemented

- Responsive Focus Table and domino-board presentation.
- Sponsored ficha backs use the sponsor logo consistently with the admin preview.
- Spectator sponsor card shows the real logo/name/CTA, has its own dismiss X, and collapses to a compact `Patrocinado por…` credit.
- Spectator chat is docked below the board with presence, messages, quick reactions, composer, collapse state, unread state, profile access, and the existing friend-request flow.
- Players see a compact read-only `Público · {count}` audience feed above their hand.
- The viewer count appears in the audience/chat panel only; it is not duplicated beside `Mano`.
- Spectator `Salir de la mesa` remains at the top.
- Spectator Share is in the chat header.
- Player Share is in the `Público` panel header beside `Ver chat`; if that panel is disabled, Share falls back to the small felt-corner control and remains available in Settings.
- `Escuchando` sits in the thin `Mirando a {player} · {n} fichas` strip.
- The focused spectator seat is a polished card with avatar, name, localized ficha count, divider, and aligned face-down fichas.
- Player and spectator layouts keep the board visible with chat open and preserve the existing hand, voice, quick chat, timers, sharing, leave/forfeit, reconnect, sponsor, and results behavior.
- TikTok/broadcast layout work, sponsor fixes, tournament/recent-player work, sound/setup briefs, QA references, and the other current working-tree additions must also be preserved and uploaded.

The deterministic previews are available at:

- `http://127.0.0.1:5174/preview.html?s=spectator-chat-sponsored`
- `http://127.0.0.1:5174/preview.html?s=player-spectator-chat`

## Current validation evidence

- `npm.cmd run build`: passed.
- `npx.cmd vitest run`: 19 test files and 235 tests passed.
- `npm.cmd run lint`: exited successfully with repository warnings and no errors.
- `git diff --check`: passed; Git only printed the existing CRLF normalization notice for `design-qa.md`.
- Spectator and player previews were checked at 390 × 844 with no page-level vertical overflow.

## Upload procedure

1. Inspect `git status --short --branch` and `git diff` so every current change is accounted for.
2. Re-run:
   - `npm.cmd run build`
   - `npx.cmd vitest run`
   - `npm.cmd run lint`
   - `git diff --check`
3. Treat existing lint warnings as warnings; stop for any new error, failed test, build failure, or whitespace error.
4. Stage the complete intentional working tree with `git add -A`. Never stage `.env`, credentials, `node_modules`, build output, or other ignored/private files.
5. Review `git diff --cached --stat` and `git diff --cached` before committing. Confirm the new `src/ui/SpectatorChat.tsx` and `src/ui/spectator-chat.css` files are included.
6. Commit with a clear message such as `Improve spectator chat and sponsored table UI`.
7. Run `git fetch origin`. If `origin/main` advanced, rebase the new local commit onto it and resolve conflicts without dropping any current feature. Re-run the checks after conflict resolution.
8. Push the finished commit to `origin main`.
9. Confirm the commit is visible on `https://github.com/davidfranzini44-dotcom/capicua`.
10. Confirm the corresponding Vercel production deployment succeeds. Use the repository's existing Vercel project/linkage and automatic deployment when configured; otherwise deploy this exact commit with the existing Vercel configuration. Do not create a duplicate Vercel project.
11. Open the production spectator and player flows and verify the viewer-count removal, relocated Share buttons, focused-player card, chat, and sponsor states.
12. Report the commit SHA, GitHub URL, production URL, deployment status, and final verification results.

Do not leave this as a local-only commit or a draft. The requested outcome is the complete current work uploaded to GitHub and live through the existing Vercel project.

# Capicúa sound setup — handoff for Claude

## Goal

Finish and verify the game's new table sounds so a player hears a tactile ficha placement, a two-knock pass, a felt draw, and clear but restrained celebrations. The sounds should work in actual Traditional games and in the preview, respect the existing sound preference, and never obscure play or fire twice for one action.

Repository: https://github.com/davidfranzini44-dotcom/capicua  
Local checkout: `C:\Users\Lissa\OneDrive\Escritorio\domino-apuestas`  
Soundboard: `http://127.0.0.1:4173/preview.html?s=fx-sounds`  
Scripted game preview: `http://127.0.0.1:4173/preview.html?s=fx` (`fx-win` and `fx-lose` also exist)

Read any applicable `AGENTS.md` and inspect `git status` before editing. Preserve all unrelated work. Arcade development is also in progress in this checkout; see `CLAUDE_ARCADE_BUILD_BRIEF.md` if you need context, but do not replace its code or include it in a sound-only commit.

## What is already made locally

- `scripts/make-sounds.mjs` generates the original audio assets. Run `node scripts/make-sounds.mjs` to rebuild them. It uses a fixed random seed and no third-party recordings.
- `public/sounds/sfx/` contains 15 mono WAV clips (about 392 KB total): four `tile` variations, three `knock` variations, three `draw` variations, and one each for `paseCorrido`, `capicua`, `win`, `second`, and `lose`.
- `src/lib/sfx.ts` preloads and decodes the clips with Web Audio, avoids repeating the same variation consecutively, plays through the existing master volume, and keeps its earlier synthesized sounds as a fallback if clips are unavailable. The existing `capicua.sfx` preference controls these table sounds.
- `src/lib/tableFx.ts` chooses sounds from new game events. `src/ui/TableView.tsx` plays a local tile sound on tap and suppresses the matching server event sound when it arrives.
- `src/dev/preview.tsx` has the `fx-sounds` listening page and the scripted `fx`, `fx-win`, and `fx-lose` sequences.
- The production build passed and `tests/tableFx.test.ts` passed all 10 tests after this work. The listening page rendered and a tile button was clicked without a browser error. These are checks, not a claim that the final mix has been judged by ear on every device.

## Finish the integration

1. Inspect the present changes and generated files. Confirm that regenerating the WAVs produces the checked-in assets consistently and that all 15 paths are served from `public` in development and the production build.
2. Listen to every effect on the soundboard, then play through the scripted `fx`, `fx-win`, and `fx-lose` previews. Adjust clip balance, harshness, duration, and spacing if needed. Frequent tile and pass sounds should be comfortable over a whole game. Celebrations should read clearly without drowning the next action.
3. Verify real play timing: one sound for your own placement, one for each opponent placement, the right pass/draw cue, a single pase corrido or Capicúa cue, and one end-of-game cue. Check quick consecutive events, slow server responses, reconnection, and a fresh page load. Add focused tests only for a real timing or mapping risk you find.
4. Verify the table sound switch works after turning it off/on, after refresh, on mobile browsers if available, and after returning from a backgrounded tab. A failed asset load must use the fallback without an uncaught error or broken game flow. Avoid large volume jumps when several cues overlap.
5. Keep `src/quickchat.ts` distinct: its phrase buttons currently use device text-to-speech and the separate `capicua.sound` preference. There are no recorded voice clips. Do not label the generated table effects as human recordings or silently change the voice preference. If voice lines are part of a later request, use licensed or user-provided recordings and retain a working TTS fallback.
6. Run `npm.cmd run build`, `npm.cmd exec -- vitest run tests/tableFx.test.ts`, and `npm.cmd run lint`. Report any existing unrelated lint warnings separately. Show the soundboard and summarize what you heard and changed.

## Completion criteria

The eight effect types play from the new clips during a game, the three repeated actions have audible variation, the sound preference and fallback work, event timing does not duplicate sounds, and the preview gives the user a reliable way to hear each cue. Report any device or voice-recording limitation honestly. Keep sound-related changes separate from the concurrent Arcade edits when preparing a commit or upload.

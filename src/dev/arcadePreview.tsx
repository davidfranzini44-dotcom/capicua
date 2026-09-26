// Dev-only Arcade screens for /preview.html?s=arcade…:
//   arcade          my turn, every power usable (tap Poderes and try each one; moves apply locally)
//   arcade-locked   my left end closed by a Candado
//   arcade-empty    no powers left
//   arcade-stuck    nothing to play but a power could help: Pasar button
//   arcade-wild     a Comodín on the board (star on the changed half) and a lock on a rival
//   arcade-hand     the hand summary with its star
//   arcade-win      match won 3–1
//   arcade-practice a real practice match against the bots
//   arcade-sheet    the home screen's Arcade sheet
import { useState } from 'react';
import { applyMove, arcadeRules, nextHand, type GameState, type Move, type Placed, type Seat, type Tile } from '../../supabase/functions/_shared/domino.ts';
import { publicState } from '../../supabase/functions/_shared/table.ts';
import { ArcadeSheet } from '../ui/MainScreen';
import { PracticeTable } from '../ui/PracticeTable';
import { TableView } from '../ui/TableView';

const NAMES = ['', 'Yokasta', 'Robert', 'Kirsy'];

/** A mid-hand Arcade state with chosen hands and board (values left → right). */
function arcadeState(o: {
  hands: Tile[][]; line: ([number, number] | Placed)[]; turn: Seat; charges?: number[]; scores?: number[];
  lock?: GameState['arcade'] extends infer A ? (A extends { lock: infer L } ? L : never) : never;
}): GameState {
  return {
    rules: arcadeRules(), scores: o.scores ?? [1, 2], handNo: 4, hands: o.hands, boneyard: [],
    line: o.line.map((p) => (Array.isArray(p) ? { a: p[0], b: p[1], seat: 1 as Seat } : p)), origin: 0,
    mano: 0, turn: o.turn, lastPlayer: 3, passesSinceLastPlay: 0, mustOpen: null,
    voids: o.hands.map(() => []), events: [], handResult: null, winner: null,
    tally: { capicuas: [0, 1], tranques: [0, 0], hands: [1, 2] },
    arcade: { charges: o.charges ?? [2, 1, 2, 0], lock: o.lock ?? null, powerUsed: false, passes: 0 },
  };
}

/** A table that plays locally: my moves apply at once; nobody else moves. */
function LocalTable({ initial }: { initial: GameState }) {
  const [game, setGame] = useState(initial);
  const [log, setLog] = useState<string[]>([]);
  (window as unknown as { __arcadeMoves: string[] }).__arcadeMoves = log;
  const onPlay = (m: Move) => {
    setLog((l) => [...l, JSON.stringify(m)]);
    try { setGame((g) => applyMove(g, m)); } catch (e) { setLog((l) => [...l, `refused: ${(e as Error).message}`]); }
  };
  return (
    <TableView view={publicState(game)} myHand={game.hands[0]} mySeat={0} names={NAMES}
      onPlay={onPlay} onNextHand={() => setGame((g) => nextHand(g))} onExit={() => {}} chat={{}} onChat={() => {}}
      endActions={<><button className="btn primary">Revancha</button><button className="btn ghost">Salir</button></>} />
  );
}

// Everything usable: 4-6 then 6-2 (Doble golpe), 2-5 can become a Comodín, 4-6 plays normally (Candado).
const FULL_HAND: Tile[] = [[0, 3], [1, 1], [2, 5], [2, 6], [3, 3], [4, 6]];
const RIVALS: Tile[][] = [[[0, 0], [0, 1], [1, 3], [5, 5], [0, 2]], [[1, 2], [2, 2], [3, 4], [0, 5]], [[1, 5], [3, 5], [4, 4], [0, 4], [5, 6]]];

export function ArcadePreview({ s }: { s: string }) {
  if (s === 'arcade-practice') return <PracticeTable mode="2v2" ruleset="arcade" onExit={() => {}} />;
  if (s === 'arcade-sheet') {
    return <ArcadeSheet profile={null} online onPractice={() => {}} onOnline={() => {}} onPrivate={() => {}} onSignIn={() => {}} onClose={() => {}} />;
  }
  if (s === 'arcade-locked') {
    return <LocalTable initial={arcadeState({ hands: [FULL_HAND, ...RIVALS], line: [[1, 4], [4, 4]], turn: 0, lock: { side: 'L', seat: 0 } })} />;
  }
  if (s === 'arcade-empty') {
    return <LocalTable initial={arcadeState({ hands: [FULL_HAND, ...RIVALS], line: [[1, 4]], turn: 0, charges: [0, 1, 2, 0] })} />;
  }
  if (s === 'arcade-stuck') {
    return <LocalTable initial={arcadeState({ hands: [[[0, 0], [2, 3], [1, 1]], ...RIVALS], line: [[5, 6]], turn: 0 })} />;
  }
  if (s === 'arcade-wild') {
    const line: Placed[] = [{ a: 1, b: 4, seat: 1 }, { a: 4, b: 6, seat: 2 }, { a: 6, b: 2, seat: 3, wild: 'a', phys: [2, 3] }];
    return <LocalTable initial={arcadeState({ hands: [FULL_HAND, ...RIVALS], line, turn: 1, lock: { side: 'R', seat: 1 } })} />;
  }
  if (s === 'arcade-hand' || s === 'arcade-win') {
    const g = arcadeState({ hands: [[[4, 6]], ...RIVALS], line: [[1, 4]], turn: 0, scores: s === 'arcade-win' ? [2, 1] : [1, 1] });
    return <LocalTable initial={applyMove(g, { type: 'play', tile: [4, 6], side: 'R' })} />;
  }
  return <LocalTable initial={arcadeState({ hands: [FULL_HAND, ...RIVALS], line: [[1, 4]], turn: 0 })} />;
}

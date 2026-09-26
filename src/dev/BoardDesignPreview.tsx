import { useEffect, useState } from 'react';
import { applyMove, forcedMove, fullSet, newGame, nextHand, type GameState, type Tile } from '../../supabase/functions/_shared/domino';
import { chooseMove } from '../../supabase/functions/_shared/bot';
import { publicRules, publicState } from '../../supabase/functions/_shared/table';
import { TableView, type ChatBubbles } from '../ui/TableView';

// Deterministic, offline fixture matching the selected board mock. All 28 tiles are unique.
function example(): GameState {
  const mine: Tile[] = [[0, 1], [0, 5], [1, 2], [1, 6], [3, 6], [4, 6], [5, 5]];
  const line = [{ a: 3, b: 5, seat: 3 as const }, { a: 5, b: 6, seat: 2 as const }, { a: 6, b: 6, seat: 1 as const }];
  const used = new Set([...mine.map(t => t.join('-')), ...line.map(t => `${t.a}-${t.b}`)]);
  const rest = fullSet().filter(t => !used.has(t.join('-')));
  return { ...newGame(() => .5, publicRules('2v2')), hands: [mine, rest.slice(0, 6), rest.slice(6, 12), rest.slice(12)], line, origin: 2, turn: 0, mano: 1, lastPlayer: 3, mustOpen: null, scores: [42, 28], handNo: 3, events: [] };
}

export function BoardDesignPreview({ auto = false, focus = false }: { auto?: boolean; focus?: boolean }) {
  const [game, setGame] = useState(example);
  const [chat, setChat] = useState<ChatBubbles>({});
  useEffect(() => {
    if (game.winner !== null) return;
    if (game.handResult) {
      if (!auto) return;
      const timer = setTimeout(() => setGame(g => nextHand(g)), 2600);
      return () => clearTimeout(timer);
    }
    if (!auto && game.turn === 0 && !forcedMove(game, 0)) return;
    const timer = setTimeout(() => setGame(g => applyMove(g, chooseMove(g, g.turn))), auto ? 950 : 1200);
    return () => clearTimeout(timer);
  }, [game, auto]);
  return <TableView view={publicState(game)} myHand={game.hands[0]} mySeat={0} names={['Tú', 'Chelo', 'Yuly', 'Papo']}
    presentation={focus || auto ? 'focus' : 'classic'}
    avatars={['/images/papo-avatar.webp', '/images/papo-avatar.webp', '/images/yuly-avatar.webp', '/images/papo-avatar.webp']}
    onPlay={move => setGame(g => applyMove(g, move))} onNextHand={() => setGame(g => nextHand(g))}
    onExit={() => { window.location.href = '/'; }} chat={chat} onChat={id => setChat({0: { id, at: Date.now() }})}
    endActions={<button className="btn primary" onClick={() => setGame(example())}>Jugar otra</button>} />;
}

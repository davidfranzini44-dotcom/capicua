import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMove, forcedMove, isPollona, newGame, nextHand, playerCount, sideOf,
  type GameState, type Mode, type Seat,
} from '../../supabase/functions/_shared/domino.ts';
import { chooseMove } from '../../supabase/functions/_shared/bot.ts';
import { publicRules, publicState, TIMING } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { COOLDOWN_MS, playPhrase, type PhraseId } from '../quickchat';
import { TableView, type ChatBubbles } from './TableView';

const ME: Seat = 0;
const NAMES = ['', 'Chelo', 'Yuly', 'Papo'];
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** Offline game against bots, played entirely in the browser. */
export function PracticeTable({ mode, onExit }: { mode: Mode; onExit: () => void }) {
  const { t } = useI18n();
  const fresh = useCallback(() => newGame(Math.random, publicRules(mode)), [mode]);
  const [game, setGame] = useState<GameState>(fresh);
  const [chat, setChat] = useState<ChatBubbles>({});
  const lastSaid = useRef(0);

  const bots = Array.from({ length: playerCount(mode) - 1 }, (_, i) => (i + 1) as Seat);
  const rivals = bots.filter((b) => sideOf(mode, b) !== sideOf(mode, ME));
  const partner = bots.find((b) => sideOf(mode, b) === sideOf(mode, ME));

  const say = useCallback((seat: Seat, id: PhraseId, delay = 0) => {
    setTimeout(() => {
      setChat((c) => ({ ...c, [seat]: { id, at: Date.now() } }));
      playPhrase(id, seat);
    }, delay);
  }, []);

  // Bots move; for you, draws and passes happen by themselves.
  useEffect(() => {
    if (game.handResult) return;
    if (game.turn === ME) {
      const forced = forcedMove(game, ME);
      if (!forced) return;
      const id = setTimeout(() => setGame((g) => applyMove(g, forced)), forced.type === 'draw' ? TIMING.drawMs : 1400);
      return () => clearTimeout(id);
    }
    const forced = forcedMove(game, game.turn);
    const id = setTimeout(() => setGame((g) => applyMove(g, chooseMove(g, g.turn))), forced?.type === 'draw' ? TIMING.drawMs : TIMING.botMs);
    return () => clearTimeout(id);
  }, [game]);

  // Bots talk back — sparingly.
  const seen = useRef({ events: 0, hand: 0 });
  useEffect(() => {
    if (seen.current.hand !== game.handNo) seen.current = { events: 0, hand: game.handNo };
    const fresh = game.events.slice(seen.current.events);
    seen.current.events = game.events.length;
    for (const e of fresh) {
      if (e.kind === 'paseCorrido') {
        if (e.seat !== ME) say(e.seat, 'nollevas', 400);
        else if (rivals.length) say(pick(rivals), 'aymadre', 500);
      } else if (e.kind === 'pass' && e.seat === ME && rivals.length && Math.random() < 0.3) {
        say(pick(rivals), 'nollevas', 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, say]);

  const handResult = game.handResult;
  useEffect(() => {
    if (!handResult) return;
    const w = handResult.winnerSeat;
    const cheerer = w === ME ? partner : w;
    const losers = bots.filter((b) => sideOf(mode, b) !== handResult.side);
    if (game.winner !== null && isPollona(game)) {
      if (cheerer !== undefined) say(cheerer, w === ME ? 'buena' : 'pollona', 500);
    } else if (handResult.capicua) {
      if (cheerer !== undefined) say(cheerer, w === ME ? 'buena' : 'capicua', 400);
    } else if (handResult.kind === 'tranque') {
      say(pick(bots), 'tranque', 400);
    } else if (losers.length && Math.random() < 0.35) {
      say(pick(losers), 'aymadre', 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handResult]);

  // Taking too long? Someone will let you know.
  useEffect(() => {
    if (game.turn !== ME || game.handResult || forcedMove(game, ME)) return;
    const id = setTimeout(() => say(1, 'dale'), 12_000);
    return () => clearTimeout(id);
  }, [game, say]);

  const onChat = (id: PhraseId) => {
    if (Date.now() - lastSaid.current < COOLDOWN_MS) return;
    lastSaid.current = Date.now();
    say(ME, id);
  };

  return (
    <TableView
      view={publicState(game)}
      myHand={game.hands[ME]}
      mySeat={ME}
      names={NAMES}
      avatars={[null, '/images/papo-avatar.webp', '/images/yuly-avatar.webp', '/images/papo-avatar.webp']}
      onPlay={(m) => setGame((g) => applyMove(g, m))}
      onNextHand={() => setGame((g) => nextHand(g))}
      onExit={onExit}
      chat={chat}
      onChat={onChat}
      endActions={
        <>
          <button className="btn primary" onClick={() => setGame(fresh())}>{t.playAgain}</button>
          <button className="btn ghost" onClick={onExit}>{t.exit}</button>
        </>
      }
    />
  );
}

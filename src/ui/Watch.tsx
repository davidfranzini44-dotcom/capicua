// Watching a friend's game: the board from their seat, their hand face down,
// nobody's tiles revealed. Loaded on demand (like the table screen).
import { useEffect, useState } from 'react';
import type { Seat } from '../../supabase/functions/_shared/domino.ts';
import { useI18n } from '../i18n';
import { ApiError, supabase } from '../lib/supabase';
import { usePlayerStats, useRoom } from '../lib/useRoom';
import { useErrorText } from './common';
import { TableView } from './TableView';

export default function WatchScreen({ friendId, friendName, uid, onExit }: {
  friendId: string; friendName: string; uid: string; onExit: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('watch_friend', { p_friend: friendId }).then(({ data, error: e }) => {
      if (e) setError(errText(new ApiError(['not_friends', 'friend_not_playing', 'already_in_room'].includes(e.message) ? e.message : 'server_error')));
      else setRoomId(data as string);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId]);

  if (error) return <Message text={error} onBack={onExit} back={t.watch.back} />;
  if (!roomId) return <div className="screen center"><p>{t.loading}</p></div>;
  return <WatchTable roomId={roomId} friendId={friendId} friendName={friendName} uid={uid} onExit={onExit} />;
}

function Message({ text, onBack, back }: { text: string; onBack: () => void; back: string }) {
  return (
    <div className="screen center watch-message">
      <p>{text}</p>
      <button className="btn primary" onClick={onBack}>{back}</button>
    </div>
  );
}

function WatchTable({ roomId, friendId, friendName, uid, onExit }: {
  roomId: string; friendId: string; friendName: string; uid: string; onExit: () => void;
}) {
  const { t } = useI18n();
  const r = useRoom(roomId, uid);
  const stats = usePlayerStats(r.seats.filter((s) => s.user_id && !s.is_bot).map((s) => s.user_id!));

  // Stop counting as a watcher however this screen closes.
  useEffect(() => () => { supabase.rpc('stop_watching', { p_room: roomId }).then(() => {}); }, [roomId]);
  const leave = () => onExit();

  const friend = r.seats.find((s) => s.user_id === friendId);
  if (r.gone) return <Message text={t.watch.ended} onBack={leave} back={t.watch.back} />;
  if (!r.room) return <div className="screen center"><p>{t.loading}</p></div>;
  if (!friend) return <Message text={`${friendName} ${t.watch.left}`} onBack={leave} back={t.watch.back} />;
  if (!r.game) {
    return (
      <div className="screen center watch-message">
        <p>👁 <b>{friendName}</b> {t.watch.lobby}</p>
        <ul className="watch-lobby">{r.seats.map((s) => <li key={s.seat}>{s.name}</li>)}</ul>
        <button className="btn ghost" onClick={leave}>{t.watch.stop}</button>
      </div>
    );
  }

  const game = r.game;
  const view = game.public_state;
  const names = [0, 1, 2, 3].map((s) => r.seats.find((x) => x.seat === s)?.name ?? '');
  const levels = [0, 1, 2, 3].map((s) => r.seats.find((x) => x.seat === s)?.level ?? null);
  const avatars = [0, 1, 2, 3].map((s) => {
    const id = r.seats.find((x) => x.seat === s)?.user_id;
    return (id && stats[id]?.avatar_url) || null;
  });
  const away = new Set(r.seats.filter((s) => s.away).map((s) => s.seat));
  const turnSeat = r.seats.find((s) => s.seat === view.turn);
  const turnDeadline = turnSeat && !turnSeat.is_bot && !turnSeat.away && game.auto_delay_ms === game.turn_ms ? r.receivedAt + game.turn_ms : null;
  const noop = () => {};

  return (
    <TableView
      view={view}
      myHand={[]}
      mySeat={friend.seat as Seat}
      names={names}
      levels={levels}
      avatars={avatars}
      onPlay={noop}
      onNextHand={noop}
      onExit={leave}
      chat={r.chat}
      onChat={noop}
      away={away}
      pot={game.pot || undefined}
      turnDeadline={turnDeadline}
      endActions={<button className="btn primary" onClick={leave}>{t.watch.stop}</button>}
      watching={{ name: friendName, onLeave: leave }}
    />
  );
}

// A player's card: photo, level and record, chips, when they were last online,
// and adding them as a friend. At the table it also carries actions for that
// player (mute, report).
import type { ReactNode } from 'react';
import { levelFromXp, xpForLevel } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { timeAgo, useLastSeen } from '../lib/presence';
import type { PlayerStats } from '../lib/useRoom';
import { Avatar, LevelBadge } from './common';
import { AddFriendButton } from './Friends';

/**
 * `loading`: the record is still on its way — its numbers show "…" instead of zeros.
 * `online`: already known to be in the app right now (a friend's live status).
 */
export function ProfileCard({ stats, onClose, actions, loading = false, online }: {
  stats: PlayerStats; onClose: () => void; actions?: ReactNode; loading?: boolean; online?: boolean;
}) {
  const { t, lang } = useI18n();
  const seen = useLastSeen(stats.id);
  const presence = online || seen?.online
    ? <p className="last-seen on">● {t.presence.online}</p>
    : seen?.at != null ? <p className="last-seen">{t.presence.lastSeen.replace('{t}', timeAgo(seen.at, lang, t.presence.justNow))}</p>
    : null;
  const level = levelFromXp(stats.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const winRate = stats.games ? Math.round((100 * stats.wins) / stats.games) : 0;
  const n = (v: ReactNode) => (loading ? '…' : v);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-card" onClick={(e) => e.stopPropagation()}>
        <div className="avatar big"><Avatar name={stats.display_name} url={stats.avatar_url} /></div>
        <h2>{stats.display_name}</h2>
        {presence}
        <LevelBadge xp={stats.xp} big />
        <AddFriendButton userId={stats.id} />
        {actions && <div className="card-actions">{actions}</div>}
        <div className="xp-bar wide"><span style={{ width: `${(100 * (stats.xp - from)) / (to - from)}%` }} /></div>
        <div className="stat-grid">
          <div><b>{n(stats.games)}</b><small>{t.stats.games}</small></div>
          <div><b>{n(`${winRate}%`)}</b><small>{t.stats.winRate}</small></div>
          <div><b>{n(stats.capicuas)}</b><small>{t.stats.capicuas}</small></div>
          <div><b>{n(stats.pollonas)}</b><small>{t.stats.pollonas}</small></div>
          <div className="half"><b>{n(stats.chips == null ? '…' : `🪙 ${stats.chips.toLocaleString()}`)}</b><small>{t.stats.chips}</small></div>
          <div className="half"><b>{n(`🪙 ${stats.biggest_pot.toLocaleString()}`)}</b><small>{t.stats.biggestPot}</small></div>
        </div>
        <button className="btn ghost wide" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}

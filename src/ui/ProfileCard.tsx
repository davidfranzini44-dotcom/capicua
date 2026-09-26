// A player's card: photo, level and record, and adding them as a friend.
import { levelFromXp, xpForLevel } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import type { PlayerStats } from '../lib/useRoom';
import { Avatar, LevelBadge } from './common';
import { AddFriendButton } from './Friends';

export function ProfileCard({ stats, onClose }: { stats: PlayerStats; onClose: () => void }) {
  const { t } = useI18n();
  const level = levelFromXp(stats.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const winRate = stats.games ? Math.round((100 * stats.wins) / stats.games) : 0;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet profile-card" onClick={(e) => e.stopPropagation()}>
        <div className="avatar big"><Avatar name={stats.display_name} url={stats.avatar_url} /></div>
        <h2>{stats.display_name}</h2>
        <LevelBadge xp={stats.xp} big />
        <AddFriendButton userId={stats.id} />
        <div className="xp-bar wide"><span style={{ width: `${(100 * (stats.xp - from)) / (to - from)}%` }} /></div>
        <div className="stat-grid">
          <div><b>{stats.games}</b><small>{t.stats.games}</small></div>
          <div><b>{winRate}%</b><small>{t.stats.winRate}</small></div>
          <div><b>{stats.capicuas}</b><small>{t.stats.capicuas}</small></div>
          <div><b>{stats.pollonas}</b><small>{t.stats.pollonas}</small></div>
          <div className="span2"><b>🪙 {stats.biggest_pot.toLocaleString()}</b><small>{t.stats.biggestPot}</small></div>
        </div>
        <button className="btn ghost wide" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}

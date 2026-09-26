// Small pieces shared by the main screen, the hub tabs and the table screens.
import { useState } from 'react';
import { levelFromXp, levelTitle } from '../../supabase/functions/_shared/table.ts';
import { errorText, useI18n } from '../i18n';
import { ApiError, avatarSrc, type Profile } from '../lib/supabase';

/**
 * What goes inside an avatar circle: the player's picture, or their initial
 * when there's none (or it won't load). The circle itself is the caller's.
 */
export function Avatar({ name, url }: { name: string; url?: string | null }) {
  const src = url?.startsWith('/images/') ? url : avatarSrc(url);
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return <img className="avatar-img" src={src} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} onError={() => setFailed(src)} />;
  }
  return <>{(name.trim()[0] ?? '?').toUpperCase()}</>;
}

export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => errorText(t, e instanceof ApiError ? e.code : 'server_error');
}

export function ChipBalance({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  return <span className="chip-balance">🪙 {profile.chips.toLocaleString()} <small>{t.chips}</small></span>;
}

export function LevelBadge({ xp, big }: { xp: number; big?: boolean }) {
  const { lang } = useI18n();
  const level = levelFromXp(xp);
  return (
    <span className={`level-badge ${big ? 'big' : ''}`}>
      <b>{level}</b> {levelTitle(level)[lang]}
    </span>
  );
}

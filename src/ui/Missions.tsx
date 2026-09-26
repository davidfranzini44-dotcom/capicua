import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { Mission, Missions } from '../lib/missions';
import { useErrorText } from './common';
import { Sheet } from './MainScreen';
import './social.css';

const ICONS: Record<Mission['kind'], string> = {
  play: '🎲', win: '🏅', hands: '✋', capicua: '✨', mode_1v1: '⚔️', mode_2v2: '🤝', mode_ffa: '🌀', bonus: '🎁',
};

/** "Juega 2 partidas" etc., with the goal filled in. */
function useMissionText() {
  const { t } = useI18n();
  return (m: Mission) => t.missions.kinds[m.kind][m.goal === 1 ? 0 : 1].replace('{n}', String(m.goal));
}

function useCountdown(to: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!to) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [to]);
  if (!to) return '';
  const mins = Math.max(0, Math.round((to - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

/** Today's three missions and the bonus for finishing them all. */
export function MissionsSheet({ m, onClose, onChest }: { m: Missions; onClose: () => void; onChest?: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const text = useMissionText();
  const left = useCountdown(m.resetsAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const claim = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const got = await m.claim(id);
      if (got.chest) onChest?.();
      setNote({ ok: true, text: got.chest ? t.missions.gotChest : `+🪙 ${got.chips?.toLocaleString()}${got.xp ? ` · +${got.xp} XP` : ''}` });
    } catch (e) {
      setNote({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  };

  const row = (x: Mission) => {
    const pct = Math.min(100, Math.round((100 * x.progress) / x.goal));
    const ready = m.ready(x);
    return (
      <li key={x.id} className={`mission ${x.claimed ? 'claimed' : ready ? 'ready' : ''}`}>
        <span className="mission-icon" aria-hidden>{ICONS[x.kind]}</span>
        <span className="mission-main">
          <b>{text(x)}</b>
          <span className="mission-bar" role="progressbar" aria-valuemin={0} aria-valuemax={x.goal} aria-valuenow={Math.min(x.progress, x.goal)}>
            <i style={{ width: `${pct}%` }} />
          </span>
          <small>{Math.min(x.progress, x.goal)}/{x.goal} · 🪙 {x.chips.toLocaleString()} · +{x.xp} XP</small>
        </span>
        {x.claimed ? <span className="mission-done">✓</span>
          : <button className="btn primary small" disabled={!ready || busy !== null} onClick={() => claim(x.id)}>{t.missions.claim}</button>}
      </li>
    );
  };

  return (
    <Sheet onClose={onClose} className="missions-sheet">
      <h2>🎯 {t.missions.title}</h2>
      {left && <p className="fine">{t.missions.newIn} {left}</p>}
      <ul className="mission-list">{m.missions.map(row)}</ul>
      {m.bonus && (
        <div className={`mission bonus ${m.bonus.claimed ? 'claimed' : m.ready(m.bonus) ? 'ready' : ''}`}>
          <span className="mission-icon" aria-hidden>🎁</span>
          <span className="mission-main">
            <b>{t.missions.bonus}</b>
            <small>{t.missions.bonusReward} · {Math.min(m.bonus.progress, 3)}/3</small>
          </span>
          {m.bonus.claimed ? <span className="mission-done">✓</span>
            : <button className="btn primary small" disabled={!m.ready(m.bonus) || busy !== null} onClick={() => claim('bonus')}>{t.missions.open}</button>}
        </div>
      )}
      {note && <p className={note.ok ? 'note-ok' : 'error'}>{note.text}</p>}
      <p className="fine">{t.missions.rule}</p>
    </Sheet>
  );
}

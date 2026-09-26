// Reward chests: 4 slots on the home screen. Win an online game against at
// least one other person → a chest. Start its timer, wait (or pay chips to
// skip), then open it for chips and XP.
import { useEffect, useState } from 'react';
import { CHEST_SLOTS, CHESTS, rushCost, type ChestKind } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import type { ChestRow } from '../lib/useChests';
import { api } from '../lib/supabase';
import { useErrorText } from './common';
import { Confetti } from './Confetti';
import { Sheet } from './MainScreen';

const PALETTE: Record<ChestKind, { body: string; dark: string; band: string; glow: string }> = {
  wood: { body: '#b0703a', dark: '#6e3f18', band: '#d9a441', glow: '#ffcf7a' },
  silver: { body: '#b9c6d3', dark: '#6d7f91', band: '#eef3f8', glow: '#dff1ff' },
  gold: { body: '#f2b822', dark: '#a86a00', band: '#fff0a0', glow: '#ffe066' },
  diamond: { body: '#46c8e8', dark: '#136f8f', band: '#c9f6ff', glow: '#8ef0ff' },
};

/** A chunky treasure chest. `open` swings the lid up. */
export function ChestArt({ kind, open = false, className = '' }: { kind: ChestKind; open?: boolean; className?: string }) {
  const c = PALETTE[kind];
  return (
    <svg viewBox="0 0 100 90" className={`chest-art ${open ? 'open' : ''} ${className}`} aria-hidden>
      <ellipse cx="50" cy="84" rx="38" ry="5" fill="#000" opacity=".25" />
      {open && <ellipse className="chest-light" cx="50" cy="40" rx="34" ry="26" fill={c.glow} />}
      {/* body */}
      <rect x="12" y="42" width="76" height="40" rx="6" fill={c.body} stroke={c.dark} strokeWidth="3" />
      <rect x="12" y="42" width="76" height="9" fill={c.dark} opacity=".25" />
      <rect x="24" y="42" width="8" height="40" fill={c.band} stroke={c.dark} strokeWidth="1.5" />
      <rect x="68" y="42" width="8" height="40" fill={c.band} stroke={c.dark} strokeWidth="1.5" />
      {/* lid */}
      <g className="chest-lid">
        <path d="M12 44 Q12 16 50 16 Q88 16 88 44 Z" fill={c.body} stroke={c.dark} strokeWidth="3" />
        <path d="M24 44 Q24 20 30 18 L36 17.5 Q32 24 32 44 Z" fill={c.band} stroke={c.dark} strokeWidth="1.5" />
        <path d="M76 44 Q76 20 70 18 L64 17.5 Q68 24 68 44 Z" fill={c.band} stroke={c.dark} strokeWidth="1.5" />
        <path d="M20 26 Q34 18 48 18" stroke="#fff" strokeOpacity=".45" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      {/* lock */}
      <rect x="42" y="38" width="16" height="18" rx="3" fill={c.band} stroke={c.dark} strokeWidth="2.5" />
      <circle cx="50" cy="46" r="2.6" fill={c.dark} />
      <rect x="49" y="47" width="2" height="5" fill={c.dark} />
    </svg>
  );
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

type Reward = { kind: ChestKind; chips: number; xp: number; cost?: number };

/** The row of 4 chest slots on the home screen. */
export function ChestSlots({ chests, enabled, onNeedAccount, onChanged }: {
  chests: ChestRow[]; enabled: boolean; onNeedAccount: () => void; onChanged: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<ChestRow | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  const now = useNow(chests.some((c) => c.unlock_at));
  const unlocking = chests.find((c) => c.unlock_at && new Date(c.unlock_at).getTime() > now);

  return (
    <>
      <div className="slots chests">
        {Array.from({ length: CHEST_SLOTS }, (_, slot) => {
          const c = chests.find((x) => x.slot === slot);
          if (!c) {
            return (
              <button key={slot} className="slot empty-slot" onClick={enabled ? undefined : onNeedAccount} disabled={enabled}>
                <span className="slot-ghost">🎁</span>
                <small>{t.chest.empty}</small>
              </button>
            );
          }
          const at = c.unlock_at ? new Date(c.unlock_at).getTime() : null;
          const ready = at !== null && at <= now;
          const state = ready ? 'ready' : at ? 'unlocking' : 'locked';
          return (
            <button key={slot} className={`slot chest-slot chest-${c.kind} ${state}`} onClick={() => setPicked(c)}>
              <ChestArt kind={c.kind} />
              <small className="chest-label">
                {state === 'ready' ? t.chest.open : state === 'unlocking' ? `⏱ ${fmt(at! - now)}` : `🔒 ${fmt(CHESTS[c.kind].unlockMin * 60_000)}`}
              </small>
            </button>
          );
        })}
      </div>
      {picked && (
        <ChestSheet
          chest={picked} now={now} busyWith={unlocking && unlocking.id !== picked.id ? unlocking : null}
          onClose={() => setPicked(null)}
          onOpened={(r) => { setPicked(null); setReward(r); onChanged(); }}
          onStarted={() => { setPicked(null); onChanged(); }}
        />
      )}
      {reward && <ChestReveal reward={reward} onClose={() => setReward(null)} />}
    </>
  );
}

function ChestSheet({ chest, now, busyWith, onClose, onOpened, onStarted }: {
  chest: ChestRow; now: number; busyWith: ChestRow | null;
  onClose: () => void; onOpened: (r: Reward) => void; onStarted: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = CHESTS[chest.kind];
  const at = chest.unlock_at ? new Date(chest.unlock_at).getTime() : null;
  const ready = at !== null && at <= now;
  const left = at === null ? cfg.unlockMin * 60_000 : Math.max(0, at - now);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet onClose={onClose} className={`chest-sheet chest-${chest.kind}`}>
      <ChestArt kind={chest.kind} className={ready ? 'wiggle' : ''} />
      <h2>{t.chest.names[chest.kind]}</h2>
      <p className="fine">🪙 {cfg.chips[0].toLocaleString()}–{cfg.chips[1].toLocaleString()} · ⭐ +{cfg.xp} XP</p>
      {ready ? (
        <button className="btn primary wide big-btn" disabled={busy}
          onClick={() => run(async () => onOpened(await api<Reward>('chest_open', { id: chest.id })))}>
          🎉 {t.chest.open}
        </button>
      ) : (
        <>
          {at === null ? (
            busyWith ? <p className="fine">{t.chest.oneAtATime}</p> : (
              <button className="btn primary wide big-btn" disabled={busy}
                onClick={() => run(async () => { await api('chest_start', { id: chest.id }); onStarted(); })}>
                ⏱ {t.chest.start} ({fmt(left)})
              </button>
            )
          ) : (
            <p className="chest-timer">⏱ {fmt(left)}</p>
          )}
          <button className="btn ghost wide" disabled={busy}
            onClick={() => run(async () => onOpened(await api<Reward>('chest_rush', { id: chest.id })))}>
            ⚡ {t.chest.rush} · 🪙 {rushCost(left).toLocaleString()}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

/** The payoff: chest shakes, bursts open, rewards count up. */
export function ChestReveal({ reward, onClose }: { reward: Reward; onClose: () => void }) {
  const { t } = useI18n();
  const [stage, setStage] = useState<'shake' | 'open'>('shake');
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setStage('open'), 900);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (stage !== 'open') return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setShown(Math.round(reward.chips * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [stage, reward.chips]);
  return (
    <div className="reveal-backdrop" onClick={stage === 'open' ? onClose : undefined}>
      {stage === 'open' && <Confetti pieces={90} duration={2600} />}
      <div className={`reveal-card chest-${reward.kind}`}>
        <h2 className="reveal-title">{t.chest.names[reward.kind]}</h2>
        <ChestArt kind={reward.kind} open={stage === 'open'} className={stage === 'shake' ? 'shake' : 'burst'} />
        {stage === 'open' && (
          <div className="reveal-loot">
            <div className="loot"><span>🪙</span><b>+{shown.toLocaleString()}</b></div>
            <div className="loot"><span>⭐</span><b>+{reward.xp} XP</b></div>
            {reward.cost ? <small className="fine">⚡ −{reward.cost.toLocaleString()} 🪙</small> : null}
            <button className="btn primary" onClick={onClose}>{t.chest.collect}</button>
          </div>
        )}
      </div>
    </div>
  );
}

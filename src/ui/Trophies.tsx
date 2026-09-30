// Tournament glory: the cup (gold, silver, bronze), the champion's celebration, the trophy at
// the end of a final, and a player's tournament history.
import { useEffect, useId, useRef } from 'react';
import { TOURNAMENT } from '../../supabase/functions/_shared/tournament.ts';
import { useI18n, type Strings } from '../i18n';
import { finishOf, metalOf, type Finish } from '../lib/tournamentPlace';
import type { TournamentHistoryRow } from '../lib/useTournament';
import { Confetti } from './Confetti';
import './trophies.css';

const METALS = {
  gold: ['#fff4b8', '#f5c542', '#a8750b'],
  silver: ['#ffffff', '#cfd6df', '#7d8896'],
  bronze: ['#ffd9b3', '#d98b4a', '#7a4418'],
} as const;

/** A trophy cup, drawn (no image files): gold for the champion, silver and bronze below. */
export function TrophyCup({ size = 96, metal = 'gold', className = '' }: { size?: number; metal?: keyof typeof METALS; className?: string }) {
  const id = useId().replace(/:/g, '');
  const [hi, mid, lo] = METALS[metal];
  return (
    <svg className={`trophy-cup ${metal} ${className}`} width={size} height={size * 1.15} viewBox="0 0 120 138" aria-hidden>
      <defs>
        <linearGradient id={`cup${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={hi} /><stop offset=".45" stopColor={mid} /><stop offset="1" stopColor={lo} />
        </linearGradient>
        <linearGradient id={`plinth${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b4524" /><stop offset="1" stopColor="#3a2412" />
        </linearGradient>
      </defs>
      {/* handles */}
      <path d="M30 22 C8 22 8 56 36 60" fill="none" stroke={`url(#cup${id})`} strokeWidth="8" strokeLinecap="round" />
      <path d="M90 22 C112 22 112 56 84 60" fill="none" stroke={`url(#cup${id})`} strokeWidth="8" strokeLinecap="round" />
      {/* bowl, stem and foot */}
      <path d="M26 10 H94 V30 C94 56 80 74 60 78 C40 74 26 56 26 30 Z" fill={`url(#cup${id})`} />
      <path d="M26 10 H94 V16 H26 Z" fill={hi} opacity=".55" />
      <rect x="53" y="76" width="14" height="16" rx="3" fill={`url(#cup${id})`} />
      <path d="M38 92 H82 L88 104 H32 Z" fill={`url(#cup${id})`} />
      {/* star on the bowl */}
      <path d="M60 26 L64.7 36.5 L76 37.6 L67.4 45 L70 56 L60 50.2 L50 56 L52.6 45 L44 37.6 L55.3 36.5 Z" fill={hi} opacity=".9" />
      {/* plinth with its plate */}
      <rect x="28" y="104" width="64" height="28" rx="5" fill={`url(#plinth${id})`} />
      <rect x="42" y="112" width="36" height="12" rx="2" fill={`url(#cup${id})`} opacity=".9" />
    </svg>
  );
}

/** "Campeón" / "Subcampeón" / "Semifinal" / "Eliminado en cuartos". */
export function finishLabel(f: Finish, t: Strings) {
  if (f.kind === 'champion') return t.tour.champion;
  if (f.kind === 'runnerUp') return t.tour.runnerUp;
  if (f.kind === 'semi') return t.tour.stages.semi;
  return f.stage ? `${t.tour.outIn} ${t.tour.stages[f.stage].toLowerCase()}` : t.tour.played;
}

/** A player's finished tournaments: where they finished, with whom, who won. */
export function TournamentHistoryList({ rows, self, onOpen }: {
  rows: TournamentHistoryRow[] | null; self: boolean; onOpen?: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  if (rows === null) return <p className="fine">{t.loading}</p>;
  if (!rows.length) return <p className="fine">{self ? t.tour.historyEmpty : t.tour.historyEmptyOther}</p>;
  return (
    <ul className="tour-history">
      {rows.map((r) => {
        const f = finishOf(r.placement, r.eliminated_round, r.rounds);
        const metal = metalOf(f);
        const date = new Date(r.finished_at).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
        const body = (
          <>
            <span className="th-medal">{metal ? <TrophyCup size={26} metal={metal} /> : <i aria-hidden>🎖️</i>}</span>
            <span className="th-main">
              <b>{r.name}</b>
              <small className={`th-place ${f.kind}`}>{finishLabel(f, t)}{r.partner ? ` · ${t.tour.withPartner.replace('{name}', r.partner)}` : ''}</small>
              <small>
                {date} · {t.modes[r.mode].name} · {(r.mode === '2v2' ? t.tour.entriesPairs : t.tour.entriesPlayers).replace('{n}', String(r.entries))}
                {f.kind !== 'champion' && r.champion ? ` · ${t.tour.wonBy.replace('{names}', r.champion)}` : ''}
              </small>
            </span>
          </>
        );
        return (
          <li key={r.id}>
            {onOpen ? <button type="button" className="th-row" onClick={() => onOpen(r.id)}>{body}</button> : <div className="th-row">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The moment it's won: a full-screen trophy for the champion (shown once per tournament),
 * with the prize, the bonus XP and the trophy that now counts on their profile.
 */
export function ChampionCelebration({ tournament, names, prize, pair, onClose }: {
  tournament: string; names: string; prize: number; pair: boolean; onClose: () => void;
}) {
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return (
    <div className="champion-overlay" role="dialog" aria-modal="true" aria-label={t.tour.celebrate}>
      <Confetti pieces={180} duration={4200} />
      <div className="champion-card">
        <div className="champion-glow" aria-hidden />
        <TrophyCup size={150} className="champion-cup" />
        <h2>{pair ? t.tour.celebratePair : t.tour.celebrate}</h2>
        <p className="champion-of">{t.tour.championOf.replace('{name}', tournament)}</p>
        <b className="champion-names">{names}</b>
        <div className="champion-rewards">
          {prize > 0 && <span>🪙 {prize.toLocaleString()}</span>}
          <span>+{TOURNAMENT.championXp} XP</span>
          <span>🏆 +1</span>
        </div>
        <small className="fine">{t.tour.addedToProfile}</small>
        <button ref={button} className="btn primary wide" onClick={onClose}>{t.tour.seeBracket}</button>
      </div>
    </div>
  );
}

/** At the end of a tournament's final: the cup for the winners, silver for the others. */
export function FinalTrophy({ won, tournament, pair = false, watching }: { won: boolean; tournament: string; pair?: boolean; watching?: boolean }) {
  const { t } = useI18n();
  const title = watching ? t.tour.finalOver
    : won ? (pair ? t.tour.finalWonPair : t.tour.finalWon)
    : pair ? t.tour.finalSecondPair : t.tour.finalSecond;
  return (
    <div className={`final-trophy ${won ? 'won' : 'second'}`}>
      <TrophyCup size={won ? 84 : 56} metal={won ? 'gold' : 'silver'} className={won ? 'champion-cup' : ''} />
      <b>{title.replace('{name}', tournament)}</b>
      {!watching && <small>{won ? `+${TOURNAMENT.championXp} XP · 🏆 +1` : `+${TOURNAMENT.runnerUpXp} XP`}</small>}
    </div>
  );
}


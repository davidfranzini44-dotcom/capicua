// A sponsor's logo printed on the felt: under the dominoes, faded so it reads as
// part of the table, never tappable during a hand (leaving the app mid-hand
// would flag the player for fair play). The link lives on "Patrocinado por…".
import type { CSSProperties } from 'react';
import { FELTS } from '../../supabase/functions/_shared/cosmetics.ts';
import { useI18n } from '../i18n';
import type { SponsorRow, TableSponsor } from '../lib/sponsor';
import { HandTile } from './Tile';

type Mark = Pick<TableSponsor, 'url' | 'style' | 'opacity' | 'size'>;

export function SponsorMark({ sponsor }: { sponsor: Mark }) {
  return (
    <img
      className={`sponsor-mark ${sponsor.style}`} src={sponsor.url} alt="" aria-hidden draggable={false}
      style={{ '--sp-opacity': sponsor.opacity, '--sp-size': sponsor.size } as CSSProperties}
    />
  );
}

/** "Mesa patrocinada por X ↗" — a button when the sponsor has a link. */
export function SponsorCredit({ sponsor, onTap }: { sponsor: TableSponsor; onTap?: () => void }) {
  const { t } = useI18n();
  const text = <>🤝 {t.sponsor.by} <b>{sponsor.name}</b></>;
  return sponsor.link && onTap
    ? <button type="button" className="sponsor-credit link" onClick={onTap}>{text} ↗</button>
    : <p className="sponsor-credit">{text}</p>;
}

/** Sponsor credit used in between-hand and match-result sheets. */
export function SponsorResultCard({ sponsor, phase, onTap }: {
  sponsor: TableSponsor;
  phase: 'hand' | 'match';
  onTap?: () => void;
}) {
  const { t } = useI18n();
  const clickable = !!(sponsor.link && onTap);
  return (
    <div className={`sponsor-result-card ${clickable ? 'clickable' : ''}`}>
      <img className="sponsor-card-logo" src={sponsor.url} alt="" draggable={false} />
      <span className="sponsor-card-copy">
        <small>{phase === 'hand' ? t.sponsor.hand : t.sponsor.match}</small>
        <b>{sponsor.name}</b>
      </span>
      {clickable
        ? <button type="button" className="sponsor-visit" onClick={onTap}>{t.sponsor.view} <span aria-hidden>↗</span></button>
        : <span className="sponsor-locked" aria-label={t.sponsor.availableAfterMatch}>✓</span>}
    </div>
  );
}

/** Persistent spectator sponsor card. It can collapse without hiding the sponsor link. */
export function SpectatorSponsorCard({ sponsor, collapsed, onTap, onDismiss }: {
  sponsor: TableSponsor;
  collapsed: boolean;
  onTap?: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  if (collapsed) {
    return (
      <button type="button" className="spectator-sponsor-chip" onClick={onTap} disabled={!sponsor.link || !onTap}>
        <img src={sponsor.url} alt="" draggable={false} />
        <span>{t.sponsor.compact}</span>
        {sponsor.link && onTap && <span aria-hidden>↗</span>}
      </button>
    );
  }
  return (
    <aside className="spectator-sponsor" aria-label={`${t.sponsor.by} ${sponsor.name}`}>
      <button type="button" className="spectator-sponsor-dismiss" onClick={onDismiss} aria-label={t.sponsor.hide}>×</button>
      <img className="sponsor-card-logo" src={sponsor.url} alt="" draggable={false} />
      <span className="sponsor-card-copy">
        <small>{t.sponsor.by}</small>
        <b>{sponsor.name}</b>
      </span>
      {sponsor.link && onTap && (
        <button type="button" className="sponsor-visit" onClick={onTap}>{t.sponsor.view} <span aria-hidden>↗</span></button>
      )}
    </aside>
  );
}

/** A small table felt with the logo on it and a few dominoes on top, to judge how it looks. */
export function SponsorFelt({ mark, felt = 'verde', tiles = true, className = '' }: {
  mark: { url: string; style: 'color' | 'white'; opacity: number; size: number } | null; felt?: string; tiles?: boolean; className?: string;
}) {
  const f = FELTS.find((x) => x.id === felt) ?? FELTS[0];
  return (
    <div className={`sp-felt table-focus ${f.color ? 'felt-tint' : ''} ${className}`} style={{ '--felt-color': f.color ?? undefined } as CSSProperties}>
      <div className="table-rail"><div className="felt">
        <div className="board-wrap">
          {mark && <SponsorMark sponsor={mark} />}
          {tiles && (
            <div className="board-scene sp-tiles" aria-hidden>
              {([[6, 6], [6, 3], [3, 1], [1, 5]] as [number, number][]).map((tl) => <HandTile key={tl.join()} tile={tl} />)}
            </div>
          )}
        </div>
      </div></div>
    </div>
  );
}

/** "Amistosas, Sala 1,000, Mesas privadas, Torneos (KXQTB)" */
export function describeTables(s: Pick<SponsorRow, 'salas' | 'custom' | 'tournaments' | 'tournament_codes'>, t: ReturnType<typeof useI18n>['t']) {
  const parts = s.salas.map((x) => (x === 0 ? t.admin.sp.friendly : `${t.admin.sp.sala} ${x.toLocaleString()}`));
  if (s.custom) parts.push(t.admin.sp.custom);
  if (s.tournaments) parts.push(s.tournament_codes.length ? `${t.admin.sp.tournaments} (${s.tournament_codes.join(', ')})` : t.admin.sp.tournaments);
  return parts.join(', ');
}

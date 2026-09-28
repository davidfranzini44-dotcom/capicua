// A sponsor's logo printed on the felt: under the dominoes, faded so it reads as
// part of the table, never tappable during a hand (leaving the app mid-hand
// would flag the player for fair play). The link lives on "Patrocinado por…".
import type { CSSProperties } from 'react';
import { useI18n } from '../i18n';
import type { TableSponsor } from '../lib/sponsor';

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

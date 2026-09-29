import { arrowPath, OWNER_ARROW, ownerBadgePoint, type OwnerRole } from './owners';

type TileBackSponsor = {
  url: string;
  style: 'color' | 'white';
};

const P = 0.26;
const C = 0.5;
const Q = 0.74;

// Pip positions in a unit square for an upright tile (columns of three for 6).
const PIPS: [number, number][][] = [
  [],
  [[C, C]],
  [[P, P], [Q, Q]],
  [[P, P], [C, C], [Q, Q]],
  [[P, P], [Q, P], [P, Q], [Q, Q]],
  [[P, P], [Q, P], [C, C], [P, Q], [Q, Q]],
  [[P, P], [Q, P], [P, C], [Q, C], [P, Q], [Q, Q]],
];

function Half({ value, ox, oy, rotate }: { value: number; ox: number; oy: number; rotate: boolean }) {
  return (
    <>
      {PIPS[value].map(([px, py], i) => (
        <circle key={i} cx={ox + (rotate ? py : px)} cy={oy + (rotate ? px : py)} r={0.085} className={`pip v${value}`} />
      ))}
    </>
  );
}

/**
 * A tile drawn in board units at (x, y): 2×1 when horizontal, 1×2 when vertical.
 * `owner` marks who played it: a colored edge badge in the direction of that
 * player, plus a light inner ring so the tile can still be read at a glance.
 */
export function TileShape({
  x, y, vertical, first, second, className, tileKey, owner, ownerName, wild, wildNote,
}: {
  x: number; y: number; vertical: boolean; first: number; second: number; className?: string;
  /** Stable physical identity, used to animate a newly placed board tile. */
  tileKey?: string;
  owner?: OwnerRole; ownerName?: string;
  /** Arcade Comodín: this half was changed to connect — it keeps a small star. */
  wild?: 'first' | 'second';
  /** Explains the change (original ficha → values in play), on hover / long press. */
  wildNote?: string;
}) {
  const w = vertical ? 1 : 2;
  const h = vertical ? 2 : 1;
  const g = 0.035; // gap so neighbouring tiles read as separate pieces
  const ownerBadge = owner ? ownerBadgePoint(x, y, w, h, owner, 0.16) : null;
  return (
    <g className={className} data-tile-key={tileKey}>
      <rect x={x + g} y={y + g + 0.05} width={w - 2 * g} height={h - 2 * g} rx={0.14} className="tile-shadow" />
      <rect x={x + g} y={y + g} width={w - 2 * g} height={h - 2 * g} rx={0.14} className="tile-face" />
      {vertical ? (
        <line x1={x + 0.18} x2={x + 0.82} y1={y + 1} y2={y + 1} className="tile-divider" />
      ) : (
        <line x1={x + 1} x2={x + 1} y1={y + 0.18} y2={y + 0.82} className="tile-divider" />
      )}
      <Half value={first} ox={x} oy={y} rotate={!vertical} />
      <Half value={second} ox={vertical ? x : x + 1} oy={vertical ? y + 1 : y} rotate={!vertical} />
      {wild && (() => {
        // Top-right corner of the changed half (first = left/top, second = right/bottom).
        const hx = x + (!vertical && wild === 'second' ? 1 : 0);
        const hy = y + (vertical && wild === 'second' ? 1 : 0);
        return (
          <g className="wild-mark">
            {wildNote && <title>{wildNote}</title>}
            <circle cx={hx + 0.84} cy={hy + 0.16} r={0.13} className="wild-bg" />
            <text x={hx + 0.84} y={hy + 0.215} textAnchor="middle" className="wild-star">★</text>
          </g>
        );
      })()}
      {owner && (
        <g className={`owner owner-${owner}`}>
          {ownerName && <title>{`${Math.min(first, second)}-${Math.max(first, second)} · ${ownerName}`}</title>}
          <rect x={x + g + 0.045} y={y + g + 0.045} width={w - 2 * g - 0.09} height={h - 2 * g - 0.09} rx={0.1} className="owner-ring" />
          {ownerBadge && <>
            <circle cx={ownerBadge.x} cy={ownerBadge.y} r={0.155} className="owner-badge-shadow" />
            <circle cx={ownerBadge.x} cy={ownerBadge.y} r={0.13} className="owner-badge" />
            <path d={arrowPath(ownerBadge.x, ownerBadge.y, 0.07, OWNER_ARROW[owner])} className="owner-mark" />
          </>}
        </g>
      )}
      {tileKey && <rect x={x - 0.04} y={y - 0.04} width={w + 0.08} height={h + 0.08} rx={0.19} className="tile-impact-ring" aria-hidden="true" />}
    </g>
  );
}

/** Standalone upright tile for the player's hand. */
export function HandTile({ tile, className }: { tile: [number, number]; className?: string }) {
  return (
    <svg viewBox="-0.02 -0.02 1.04 2.1" className={className} aria-label={`${tile[0]}-${tile[1]}`}>
      <TileShape x={0} y={0} vertical first={tile[0]} second={tile[1]} />
    </svg>
  );
}

/** Face-down tile for opponents' hands. Sponsored hands carry the current logo. */
export function TileBack({ sponsor }: { sponsor?: TileBackSponsor | null }) {
  return (
    <span className={`tile-back ${sponsor ? `sponsored ${sponsor.style}` : ''}`} aria-hidden>
      {sponsor && <img src={sponsor.url} alt="" draggable={false} />}
    </span>
  );
}

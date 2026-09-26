import { arrowPath, OWNER_ARROW, ownerBadgePoint, type OwnerRole } from './owners';

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
  x, y, vertical, first, second, className, owner, ownerName,
}: {
  x: number; y: number; vertical: boolean; first: number; second: number; className?: string;
  owner?: OwnerRole; ownerName?: string;
}) {
  const w = vertical ? 1 : 2;
  const h = vertical ? 2 : 1;
  const g = 0.035; // gap so neighbouring tiles read as separate pieces
  const ownerBadge = owner ? ownerBadgePoint(x, y, w, h, owner, 0.16) : null;
  return (
    <g className={className}>
      <rect x={x + g} y={y + g + 0.05} width={w - 2 * g} height={h - 2 * g} rx={0.14} className="tile-shadow" />
      <rect x={x + g} y={y + g} width={w - 2 * g} height={h - 2 * g} rx={0.14} className="tile-face" />
      {vertical ? (
        <line x1={x + 0.18} x2={x + 0.82} y1={y + 1} y2={y + 1} className="tile-divider" />
      ) : (
        <line x1={x + 1} x2={x + 1} y1={y + 0.18} y2={y + 0.82} className="tile-divider" />
      )}
      <Half value={first} ox={x} oy={y} rotate={!vertical} />
      <Half value={second} ox={vertical ? x : x + 1} oy={vertical ? y + 1 : y} rotate={!vertical} />
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

/** Face-down tile for opponents' hands. */
export function TileBack() {
  return <span className="tile-back" aria-hidden />;
}

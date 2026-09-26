import { useMemo } from 'react';
import type { Placed } from '../../supabase/functions/_shared/domino.ts';
import { layoutBoard } from './boardLayout';
import { TileShape } from './Tile';

export function Board({
  line, origin, newestKey, targets, onPickSide,
}: {
  line: Placed[];
  origin: number;
  newestKey: string | null;
  /** Ends the selected tile can go on; shown as tap targets. */
  targets: ('L' | 'R')[];
  onPickSide: (side: 'L' | 'R') => void;
}) {
  const layout = useMemo(() => layoutBoard(line, origin), [line, origin]);
  const [vx, vy, vw, vh] = layout.viewBox;

  return (
    <svg className="board" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet">
      {layout.tiles.map((t) => (
        <TileShape key={t.key} x={t.x} y={t.y} vertical={t.vertical} first={t.first} second={t.second} className={t.key === newestKey ? 'placed newest' : 'placed'} />
      ))}
      {layout.ends
        .filter((e) => targets.includes(e.side))
        .map((e) => (
          <g key={e.side} className="end-target" onClick={() => onPickSide(e.side)}>
            <circle cx={e.x} cy={e.y} r={0.62} />
            <text x={e.x} y={e.y + 0.24} textAnchor="middle">+</text>
          </g>
        ))}
    </svg>
  );
}

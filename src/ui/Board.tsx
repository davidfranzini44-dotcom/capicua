import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Placed, Seat, Tile } from '../../supabase/functions/_shared/domino.ts';
import { useI18n } from '../i18n';
import { bestLimit, layoutBoard } from './boardLayout';
import type { OwnerRole } from './owners';
import { TileShape } from './Tile';

export function Board({ line, origin, newestKey, targets, selected, onPickSide, ownerOf, nameOf }: {
  line: Placed[];
  origin: number;
  newestKey: string | null;
  targets: ('L' | 'R')[];
  selected?: Tile | null;
  onPickSide: (side: 'L' | 'R') => void;
  /** Who played each tile, as a marker spot (me / partner / left…); null hides the markers. */
  ownerOf?: ((seat: Seat) => OwnerRole) | null;
  /** Player names by seat, for the board's accessible description and the tile tooltips. */
  nameOf?: (seat: Seat) => string;
}) {
  const { lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // How long a row runs before the snake turns depends on the board's shape, so the tiles come out
  // as big as possible. It only changes when the screen does, never in the middle of a hand.
  const limit = useMemo(() => bestLimit(size.width, size.height), [size.width, size.height]);
  const layout = useMemo(() => layoutBoard(line, origin, limit), [line, origin, limit]);
  const [vx, vy, vw, vh] = layout.viewBox;
  const scale = Math.min(size.width / vw, size.height / vh);
  const offsetX = (size.width - vw * scale) / 2;
  const offsetY = (size.height - vh * scale) / 2;
  const empty = line.length === 0;
  // Left to right along the chain, with who played each one.
  const tilesText = line.map((p) => `${p.a}-${p.b}${nameOf ? ` (${nameOf(p.seat)})` : ''}`).join(', ');
  const described = lang === 'es' ? `Mesa: ${tilesText || 'vacía'}` : `Board: ${tilesText || 'empty'}`;
  return (
    <div className="board-scene" ref={box}>
      <svg className="board" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={described}>
        {layout.tiles.map((t) => (
          <TileShape key={t.key} x={t.x} y={t.y} vertical={t.vertical} first={t.first} second={t.second}
            className={t.key === newestKey ? 'placed newest' : 'placed'}
            owner={ownerOf ? ownerOf(t.seat) : undefined} ownerName={nameOf?.(t.seat)} />
        ))}
      </svg>
      {empty && <div className="opening-move">
        {selected && targets.length > 0
          ? <button onClick={() => onPickSide(targets[0])}>{lang === 'es' ? 'Colocar' : 'Play'} {selected.join('–')}</button>
          : <span>{lang === 'es' ? 'La mesa está lista' : 'The table is ready'}</span>}
      </div>}
      {layout.ends.map((e) => {
        const value = e.side === 'L' ? line[0].a : line[line.length - 1].b;
        const active = targets.includes(e.side);
        const side = e.side === 'L' ? (lang === 'es' ? 'izquierda' : 'left') : (lang === 'es' ? 'derecha' : 'right');
        return <button key={e.side} className={`board-end ${active ? 'available' : ''}`}
          style={{ left: offsetX + (e.x - vx) * scale, top: offsetY + (e.y - vy) * scale }}
          disabled={!active} onClick={() => onPickSide(e.side)}
          aria-label={`${lang === 'es' ? 'Colocar' : 'Play'} ${selected?.join('–') ?? ''} · ${side} · ${value}`}>
          <b>{value}</b>{active && <small>{lang === 'es' ? 'Aquí' : 'Here'}</small>}
        </button>;
      })}
    </div>
  );
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Placed, Tile } from '../../supabase/functions/_shared/domino.ts';
import { useI18n } from '../i18n';
import { layoutBoard } from './boardLayout';
import { TileShape } from './Tile';

export function Board({ line, origin, newestKey, targets, selected, onPickSide }: {
  line: Placed[];
  origin: number;
  newestKey: string | null;
  targets: ('L' | 'R')[];
  selected?: Tile | null;
  onPickSide: (side: 'L' | 'R') => void;
}) {
  const { lang } = useI18n();
  const layout = useMemo(() => layoutBoard(line, origin), [line, origin]);
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
  const [vx, vy, vw, vh] = layout.viewBox;
  const scale = Math.min(size.width / vw, size.height / vh);
  const offsetX = (size.width - vw * scale) / 2;
  const offsetY = (size.height - vh * scale) / 2;
  const empty = line.length === 0;
  return (
    <div className="board-scene" ref={box}>
      <svg className="board" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={lang === 'es' ? `Mesa: ${line.map((p) => `${p.a}-${p.b}`).join(', ') || 'vacía'}` : `Board: ${line.map((p) => `${p.a}-${p.b}`).join(', ') || 'empty'}`}>
        {layout.tiles.map((t) => (
          <TileShape key={t.key} x={t.x} y={t.y} vertical={t.vertical} first={t.first} second={t.second} className={t.key === newestKey ? 'placed newest' : 'placed'} />
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

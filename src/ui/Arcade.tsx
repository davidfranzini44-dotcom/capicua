// Capicúa Arcade at the table: the stars, the powers menu, the step-by-step bar
// for choosing a power (with confirm/cancel), and the short first-time guide.
import { useState } from 'react';
import { ARCADE, powerBlock, type GameState, type Power, type Seat, type Tile } from '../../supabase/functions/_shared/domino.ts';
import { useI18n } from '../i18n';
import type { Draft, DraftView } from '../lib/powerDraft';
import { HandTile } from './Tile';
import './arcade.css';

export const POWERS: Power[] = ['cambio', 'doble', 'comodin', 'candado'];
export const POWER_ICON: Record<Power, string> = { cambio: '🔄', doble: '⚡', comodin: '★', candado: '🔒' };

/** Three star slots for a team. */
export function Stars({ n, label }: { n: number; label: string }) {
  return (
    <span className="stars" role="img" aria-label={`${label}: ${n}/${ARCADE.stars}`}>
      {Array.from({ length: ARCADE.stars }, (_, i) => <i key={i} className={i < n ? 'on' : ''} aria-hidden>★</i>)}
    </span>
  );
}

/** Power uses left, shown by a portrait: a number with an icon (never color alone). */
export function Charges({ n, label }: { n: number; label: string }) {
  return <span className={`charge-pill ${n === 0 ? 'empty' : ''}`} aria-label={`${label}: ${n}`}>⚡{n}</span>;
}

/** The "Poderes · 2" menu: the four powers, and why one can't be used right now. */
export function PowersPanel({ state, seat, onPick, onClose }: {
  state: GameState; seat: Seat; onPick: (p: Power) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const a = t.arcade;
  const left = state.arcade?.charges[seat] ?? 0;
  return (
    <div className="powers-panel" id="powers-panel" role="dialog" aria-label={a.powersTitle}>
      <div className="powers-head">
        <b>⚡ {a.powersTitle}</b>
        <span>{left} {a.remaining}</span>
        <button className="table-icon small" onClick={onClose} aria-label={t.close}>✕</button>
      </div>
      {POWERS.map((p) => {
        const block = powerBlock(state, seat, p);
        return (
          <button key={p} className={`power-row ${block ? 'off' : ''}`} disabled={!!block} onClick={() => onPick(p)}>
            <span className="power-icon" aria-hidden>{POWER_ICON[p]}</span>
            <span className="power-text">
              <b>{a.powers[p].name}</b>
              <small>{block ? a.blocked[block] : a.powers[p].desc}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const tileText = (t: Tile) => `${t[0]}|${t[1]}`;

/**
 * Under the hand while choosing a power: what to do now, the choices that
 * aren't on the board (rival, which half, which end to lock), and Confirm /
 * Cancel. Nothing is sent before Confirm.
 */
export function PowerBar({ draft, view, nameOf, nextName, onTarget, onHalf, onLock, onConfirm, onCancel, busy }: {
  draft: Draft; view: DraftView; nameOf: (s: Seat) => string; nextName: string;
  onTarget: (s: Seat) => void; onHalf: (h: 0 | 1) => void; onLock: (side: 'L' | 'R') => void;
  onConfirm: () => void; onCancel: () => void; busy: boolean;
}) {
  const { t } = useI18n();
  const a = t.arcade;
  const endName = (side: 'L' | 'R') => (side === 'L' ? a.left : a.right);
  let prompt: string;
  switch (view.step) {
    case 'tile':
      prompt = draft.power === 'cambio' ? a.steps.cambioTile : draft.power === 'doble' ? (view.part === 2 ? a.steps.doble2 : a.steps.doble1)
        : draft.power === 'comodin' ? a.steps.comodinTile : a.steps.candadoTile;
      break;
    case 'side': prompt = a.steps.side; break;
    case 'target': prompt = a.steps.cambioTarget; break;
    case 'half': prompt = a.steps.comodinHalf; break;
    case 'lock': prompt = a.steps.candadoLock.replace('{name}', nextName); break;
    default: {
      const m = view.move!;
      if (m.type === 'cambio') prompt = a.confirmText.cambio.replace('{tile}', tileText(m.tile)).replace('{name}', nameOf(m.target));
      else if (m.type === 'doble') prompt = a.confirmText.doble.replace('{a}', tileText(m.first.tile)).replace('{b}', tileText(m.second.tile));
      else if (m.type === 'comodin') {
        const h = view.halves.find((x) => x.half === m.half)!;
        prompt = a.confirmText.comodin.replace('{tile}', tileText(m.tile)).replace('{as}', tileText(h.becomes));
      } else if (m.type === 'play' && m.lock) {
        prompt = a.confirmText.candado.replace('{tile}', tileText(m.tile)).replace('{end}', endName(m.lock)).replace('{name}', nextName);
      } else prompt = '';
    }
  }
  return (
    <div className="power-bar" role="group" aria-label={a.powers[draft.power].name}>
      <p className="power-prompt"><b>{POWER_ICON[draft.power]} {a.powers[draft.power].name}</b> · {prompt}</p>
      {view.step === 'target' && (
        <div className="power-choices">
          {view.targets.map((s) => (
            <button key={s} className="btn ghost" onClick={() => onTarget(s)}>{nameOf(s)}</button>
          ))}
        </div>
      )}
      {view.step === 'half' && (
        <div className="power-choices">
          {view.halves.map((h) => (
            <button key={h.half} className="btn ghost half-choice" onClick={() => onHalf(h.half)} aria-label={`${a.playsAs} ${tileText(h.becomes)}`}>
              <HandTile tile={h.becomes} className="mini" />
              <small>{a.playsAs} {tileText(h.becomes)}</small>
            </button>
          ))}
        </div>
      )}
      {view.step === 'lock' && (
        <div className="power-choices">
          {view.locks.map((l) => (
            <button key={l.side} className="btn ghost" onClick={() => onLock(l.side)}>🔒 {endName(l.side)} ({l.value})</button>
          ))}
        </div>
      )}
      <div className="power-actions">
        <button className="btn ghost" onClick={onCancel}>{t.cancel}</button>
        {view.step === 'confirm' && <button className="btn primary" disabled={busy} onClick={onConfirm} autoFocus>{a.confirm}</button>}
      </div>
    </div>
  );
}

/** First visit (and from the table menu): Arcade in a few lines. */
export function ArcadeIntro({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const a = t.arcade;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet arcade-intro" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={a.intro.title}>
        <h2>{a.intro.title}</h2>
        <ul className="intro-lines">
          {a.intro.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
        <ul className="intro-powers">
          {POWERS.map((p) => (
            <li key={p}><span aria-hidden>{POWER_ICON[p]}</span><b>{a.powers[p].name}</b><small>{a.powers[p].desc}</small></li>
          ))}
        </ul>
        <button className="btn primary wide" onClick={onClose} autoFocus>{a.intro.go}</button>
      </div>
    </div>
  );
}

const INTRO_KEY = 'capicua.arcadeIntro';

/** Show the guide the first time someone sits at an Arcade table on this device. */
export function useArcadeIntro(arcade: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (!arcade) return false;
    try { return localStorage.getItem(INTRO_KEY) !== '1'; } catch { return false; }
  });
  const set = (v: boolean) => {
    setOpen(v);
    if (!v) try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* storage unavailable */ }
  };
  return [open, set];
}

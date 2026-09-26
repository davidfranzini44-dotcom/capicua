import { useState, type CSSProperties } from 'react';
import {
  canUse, chipPrice, FELTS, feltById, TILE_STYLES, tilesById, type Look,
} from '../../supabase/functions/_shared/cosmetics.ts';
import { useI18n } from '../i18n';
import { lookVars, useLook } from '../lib/look';
import { useErrorText } from './common';
import { Sheet } from './MainScreen';
import { TileShape } from './Tile';
import './social.css';

/**
 * Felt colors and domino styles. Full version (profile): everything, with
 * what unlocks each one and chip purchases. Compact (table menu): just the
 * ones the player can use right now.
 */
export function LookPicker({ compact }: { compact?: boolean }) {
  const look = useLook();
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const [msg, setMsg] = useState<string | null>(null);
  const [buying, setBuying] = useState<Look | null>(null);
  const [busy, setBusy] = useState(false);
  if (!look.equip) return null;

  const usable = (l: Look) => canUse(l, look.xp, look.owned);
  const lockLabel = (l: Look) => ('level' in l.unlock ? `🔒 ${t.looks.lvl} ${l.unlock.level}` : `🪙 ${chipPrice(l)!.toLocaleString()}`);
  const pick = async (l: Look) => {
    setMsg(null);
    if (usable(l)) {
      try { await look.equip!(l.id); } catch (e) { setMsg(errText(e)); }
    } else if ('level' in l.unlock) {
      setMsg(`${t.looks.levelLocked} ${l.unlock.level}.`);
    } else if (look.guest) {
      setMsg(t.looks.guestBuy);
    } else {
      setBuying(l);
    }
  };
  const buy = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      await look.buy!(buying.id);
      setBuying(null);
    } catch (e) {
      setMsg(errText(e));
      setBuying(null);
    } finally {
      setBusy(false);
    }
  };
  const felts = compact ? FELTS.filter(usable) : FELTS;
  const styles = compact ? TILE_STYLES.filter(usable) : TILE_STYLES;
  const felt = feltById(look.felt);

  return (
    <section className={`look-picker ${compact ? 'compact' : 'card'}`}>
      {!compact && <h3 className="section-title">🎨 {t.looks.title}</h3>}
      {!compact && <LookPreview feltId={look.felt} tilesId={look.tiles} />}
      <h4>{t.looks.felt}</h4>
      <div className="look-row">
        {felts.map((f) => (
          <button key={f.id} className={`look-swatch ${look.felt === f.id ? 'on' : ''} ${usable(f) ? '' : 'locked'}`}
            style={{ '--sw': f.swatch } as CSSProperties} onClick={() => pick(f)} aria-pressed={look.felt === f.id}>
            <span className="sw-felt" />
            <small>{f.name[lang]}</small>
            {!usable(f) && <em className="look-lock">{lockLabel(f)}</em>}
          </button>
        ))}
      </div>
      <h4>{t.looks.tiles}</h4>
      <div className="look-row">
        {styles.map((s) => (
          <button key={s.id} className={`look-swatch ${look.tiles === s.id ? 'on' : ''} ${usable(s) ? '' : 'locked'}`}
            style={lookVars(felt, s)} onClick={() => pick(s)} aria-pressed={look.tiles === s.id}>
            <svg className="sw-tile" viewBox="-0.05 -0.05 2.1 1.15" aria-hidden><TileShape x={0} y={0} vertical={false} first={6} second={3} /></svg>
            <small>{s.name[lang]}</small>
            {!usable(s) && <em className="look-lock">{lockLabel(s)}</em>}
          </button>
        ))}
      </div>
      {msg && <p className="fine look-msg">{msg}</p>}

      {buying && (
        <Sheet onClose={() => setBuying(null)} className="look-buy">
          <h2>{buying.name[lang]}</h2>
          <LookPreview feltId={buying.kind === 'felt' ? buying.id : look.felt} tilesId={buying.kind === 'tiles' ? buying.id : look.tiles} />
          <p>{t.looks.buyNote}</p>
          <button className="btn primary wide" disabled={busy} onClick={buy}>
            {t.looks.buy} · 🪙 {chipPrice(buying)!.toLocaleString()}
          </button>
          <button className="btn ghost wide" onClick={() => setBuying(null)}>{t.cancel}</button>
        </Sheet>
      )}
    </section>
  );
}

/** A little table corner in a given look: felt, wood rail and three dominoes. */
export function LookPreview({ feltId, tilesId }: { feltId: string; tilesId: string }) {
  return (
    <div className="look-preview" style={lookVars(feltById(feltId), tilesById(tilesId))}>
      <svg viewBox="-0.4 -0.4 5.8 2.8" aria-hidden>
        <TileShape x={0} y={0.5} vertical={false} first={1} second={6} />
        <TileShape x={2} y={0} vertical first={6} second={6} />
        <TileShape x={3} y={0.5} vertical={false} first={6} second={4} />
      </svg>
    </div>
  );
}

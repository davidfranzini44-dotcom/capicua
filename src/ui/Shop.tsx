// Tienda: chip packs through Stripe Checkout, plus the free daily gift and rescue.
// Chips only come in — they never turn back into money.
import { useState } from 'react';
import { CHIP_PACKS, CHIPS } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { api, canClaimDaily, type Profile } from '../lib/supabase';
import { useErrorText } from './common';

const priceLabel = (cents: number) => `US$${(cents / 100).toFixed(2)}`;

export function ShopTab({ profile, guest, onLinkGoogle }: { profile: Profile; guest: boolean; onLinkGoogle: () => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const daily = canClaimDaily(profile);
  const rescue = profile.chips < CHIPS.rescueBelow && (!profile.last_rescue || profile.last_rescue < new Date().toISOString().slice(0, 10));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg(errText(e)); } finally { setBusy(null); }
  };
  const buy = (pack: string) => run(pack, async () => {
    const { url } = await api<{ url: string }>('buy_chips', { pack });
    location.href = url; // Stripe Checkout; the webhook credits the chips when it's paid
  });

  return (
    <div className="tab-page shop">
      <h2 className="tab-title">🛒 {t.shop.title}</h2>
      <p className="big-balance center">🪙 {profile.chips.toLocaleString()} <small>{t.chips}</small></p>

      {!guest && (
        <div className="free-row">
          <button className="free-card" disabled={!daily || !!busy} onClick={() => run('daily', async () => { await api('claim_daily'); })}>
            <span>🎁</span><b>+{CHIPS.daily.toLocaleString()}</b><small>{daily ? t.shop.dailyNow : t.shop.dailyDone}</small>
          </button>
          <button className="free-card" disabled={!rescue || !!busy} onClick={() => run('rescue', async () => { await api('rescue'); })}>
            <span>🛟</span><b>+{CHIPS.rescue.toLocaleString()}</b><small>{rescue ? t.shop.rescueNow : t.shop.rescueRule}</small>
          </button>
        </div>
      )}

      {guest ? (
        <section className="guest-card">
          <strong>👤 {t.guestBanner}</strong>
          <small>{t.shop.guest}</small>
          <button className="btn primary" onClick={onLinkGoogle}>{t.linkGoogle}</button>
        </section>
      ) : (
        <div className="pack-grid">
          {CHIP_PACKS.map((p, i) => (
            <button key={p.id} className={`pack tier-${i}`} disabled={!!busy} onClick={() => buy(p.id)}>
              {p.tag && <span className="pack-tag">{p.tag === 'popular' ? t.shop.popular : t.shop.best}</span>}
              <span className="pack-coins">{'🪙'.repeat(i + 1)}</span>
              <b className="pack-chips">{p.chips.toLocaleString()}</b>
              <small>{t.chips}</small>
              <span className="pack-price">{busy === p.id ? '…' : priceLabel(p.cents)}</span>
            </button>
          ))}
        </div>
      )}
      {msg && <p className="error">{msg}</p>}
      <p className="fine legal">{t.shop.legal}</p>
    </div>
  );
}

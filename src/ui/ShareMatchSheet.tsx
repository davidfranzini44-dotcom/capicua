// "Compartir partida": a link anyone can open to watch this game's board live (never the
// fichas), shared through the phone's share sheet or copied; and a QR code that opens the
// TikTok broadcast screen on a second phone. The QR is drawn here, on the phone — the link
// never goes to an outside QR service. A player can turn the link off at any time.
import { useEffect, useId, useRef, useState } from 'react';
import { ShareNetworkIcon, CopyIcon, QrCodeIcon } from '@phosphor-icons/react';
import { useI18n } from '../i18n';
import { copyText, nativeShare, shareUrl } from '../lib/shareMatch';
import type { ShareLinkState } from '../lib/useShareLink';
import './share.css';

/** The broadcast link as a QR code, drawn on this phone. */
function ShareQr({ url }: { url: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import('qrcode')
      .then((qr) => qr.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#0b251b', light: '#fffdf5' } }))
      .then((data) => { if (live) setSrc(data); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url]);
  if (failed) return <p className="share-qr-failed" role="alert">{t.share.qrFailed}</p>;
  return (
    <div className="share-qr" aria-busy={!src}>
      {src ? <img src={src} alt={t.share.qrAlt} width={180} height={180} /> : <QrCodeIcon size={64} aria-hidden />}
    </div>
  );
}

export function ShareMatchSheet({ share, onClose }: { share: ShareLinkState; onClose: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  const [copied, setCopied] = useState<'watch' | 'cast' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const { link } = share;
  const watchUrl = link ? shareUrl(link.token) : '';
  const castUrl = link ? shareUrl(link.token, true) : '';

  // Opening the sheet makes the link (one per game; reopening reuses it).
  useEffect(() => {
    if (!share.link && !share.busy && !share.error && !share.revoked) share.create();
    else share.refreshOthers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { first.current?.focus(); }, [link?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (which: 'watch' | 'cast') => {
    const ok = await copyText(which === 'watch' ? watchUrl : castUrl);
    setCopyFailed(!ok);
    setCopied(ok ? which : null);
    if (ok) setTimeout(() => setCopied((c) => (c === which ? null : c)), 2200);
  };
  const shareIt = async () => {
    setNote(null);
    const r = await nativeShare({ title: t.share.shareTitle, text: t.share.shareText, url: watchUrl });
    // Closing the share menu is fine: the link stays as it was.
    if (r === 'unavailable' || r === 'failed') setNote(t.share.shareUnavailable);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet game-sheet share-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <button className="sheet-x" onClick={onClose} aria-label={t.close}>✕</button>
        <h2 id={titleId}><ShareNetworkIcon size={24} weight="bold" aria-hidden /> {t.share.title}</h2>
        <p className="fine share-reassure">🔒 {t.share.reassure}</p>

        {share.error ? (
          <div className="share-error" role="alert">
            <p>{t.share.errors[share.error] ?? t.share.errors.server_error}</p>
            {share.error !== 'not_seated' && share.error !== 'no_live_game' && (
              <button className="btn primary" onClick={share.create} disabled={share.busy}>{t.share.retry}</button>
            )}
          </div>
        ) : share.revoked && !link ? (
          <div className="share-revoked" role="status">
            <p>{t.share.revoked}</p>
            <button className="btn primary" onClick={share.create} disabled={share.busy}>{t.share.newLink}</button>
          </div>
        ) : !link ? (
          <p className="fine" role="status">{t.share.creating}</p>
        ) : (
          <>
            <section className="share-watch" aria-label={t.share.shareWatch}>
              {canShare && (
                <button ref={first} className="btn primary wide" onClick={shareIt}>
                  <ShareNetworkIcon size={20} weight="bold" aria-hidden /> {t.share.shareWatch}
                </button>
              )}
              <button ref={canShare ? undefined : first} className={`btn ${canShare ? 'ghost' : 'primary'} wide`} onClick={() => copy('watch')}>
                <CopyIcon size={20} aria-hidden /> {copied === 'watch' ? `✓ ${t.share.copied}` : t.share.copy}
              </button>
              <input className="text-input share-url" readOnly value={watchUrl} aria-label={t.share.copy}
                onFocus={(e) => e.currentTarget.select()} />
              <p className="fine share-status" aria-live="polite">
                {copyFailed ? t.share.copyFailed : note ?? (copied ? `✓ ${t.share.copied}` : ' ')}
              </p>
            </section>

            <section className="share-cast" aria-label={t.share.tiktok}>
              <h3>{t.share.tiktok}</h3>
              <div className="share-cast-row">
                <ShareQr key={castUrl} url={castUrl} />
                <ol className="share-steps">
                  {t.share.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              <button className="btn ghost wide" onClick={() => window.open(castUrl, '_blank', 'noopener')}>{t.share.openBroadcast}</button>
              <button className="btn ghost wide" onClick={() => copy('cast')}>
                {copied === 'cast' ? `✓ ${t.share.copied}` : t.share.copyBroadcast}
              </button>
            </section>

            <p className="fine">{t.share.expiry}</p>
            <button className="btn danger wide" onClick={share.revoke} disabled={share.busy}>{t.share.revoke}</button>
          </>
        )}

        {share.others.length > 0 && (
          <p className="fine share-others">
            {t.share.others.replace('{n}', String(share.others.length))}{' '}
            <button className="link-btn" onClick={share.revokeOthers} disabled={share.busy}>{t.share.revokeAll}</button>
          </p>
        )}
      </div>
    </div>
  );
}

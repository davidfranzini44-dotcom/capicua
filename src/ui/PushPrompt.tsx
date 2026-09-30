// "Activa los avisos": every time the app opens, until this device has notifications on.
// Off → one tap asks the browser. Blocked → how to allow them in the phone's settings (the
// browser won't ask again by itself). iPhone in Safari → install Capicúa first (Apple only
// sends notifications to apps on the home screen). The device tells us which it is (push.ts),
// so the prompt stops by itself once they're on — and comes back if they're turned off.
import { useEffect, useState } from 'react';
import { BellRingingIcon } from '@phosphor-icons/react';
import { useI18n } from '../i18n';
import type { Push } from '../lib/push';
import { Sheet } from './MainScreen';

export function PushPromptSheet({ push, onInstall, onClose }: { push: Push; onInstall: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [asked, setAsked] = useState(false);
  // Turned on: say thanks, then get out of the way.
  useEffect(() => {
    if (push.state !== 'on') return;
    const id = setTimeout(onClose, 1600);
    return () => clearTimeout(id);
  }, [push.state, onClose]);

  const body = push.state === 'on' ? (
    <p className="push-prompt-done" role="status">✅ {t.push.thanks}</p>
  ) : push.state === 'denied' ? (
    <>
      <h2>{t.push.blockedTitle}</h2>
      <p className="fine">{t.push.blockedWhy}</p>
      <ul className="push-steps">{t.push.blockedSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <button className="btn primary wide" disabled={push.busy} onClick={() => { setAsked(true); push.refresh(); }}>{t.push.recheck}</button>
      {asked && <small className="fine">{t.push.stillBlocked}</small>}
    </>
  ) : push.state === 'install' ? (
    <>
      <h2>{t.push.installTitle}</h2>
      <p className="fine">{t.push.installWhy}</p>
      <button className="btn primary wide" onClick={onInstall}>{t.push.installHow}</button>
    </>
  ) : (
    <>
      <h2>{t.push.promptTitle}</h2>
      <p className="fine">{t.push.promptWhy}</p>
      <ul className="push-steps plain">{t.push.promptList.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <button className="btn primary wide" disabled={push.busy} onClick={push.toggle}>🔔 {t.push.turnOn}</button>
    </>
  );
  return (
    <Sheet onClose={onClose} className="push-prompt">
      <div className="push-prompt-icon" aria-hidden><BellRingingIcon size={44} weight="fill" /></div>
      {body}
      {push.state !== 'on' && <button className="btn ghost wide" onClick={onClose}>{t.push.notNow}</button>}
    </Sheet>
  );
}

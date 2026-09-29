// Spectators at a table: who's watching (and listening), what they say, and —
// for spectators — a way to say something and to listen to the players' voice.
// Players choose whether spectators may hear them and whether to see their messages.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleNotchIcon, HeadphonesIcon, SpeakerHighIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useI18n } from '../i18n';
import { supabase } from '../lib/supabase';
import type { Voice } from '../lib/useVoice';
import type { SpectatorMessage, Watcher } from '../lib/watch';
import { useErrorText } from './common';
import { Sheet } from './MainScreen';

/** How long a new spectator message shows in the status line. */
const TOAST_MS = 6000;
const SHOW_KEY = 'capicua.spectatorMessages';

/** A player's choice to see spectators' messages at the table (per device, on unless turned off). */
export function useShowSpectatorMessages(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(SHOW_KEY) !== '0'; } catch { return true; }
  });
  const set = (v: boolean) => {
    setOn(v);
    try { localStorage.setItem(SHOW_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  return [on, set];
}

/** The newest message from someone else, for a few seconds after it arrives ("👁 Pedro: ¡Buena!"). */
export function useSpectatorToast(messages: SpectatorMessage[], uid: string, enabled: boolean): string | null {
  const last = messages.at(-1);
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!last) return;
    // Messages already there when the table opened aren't news.
    if (seen.current === null) { seen.current = last.id; return; }
    if (last.id === seen.current) return;
    seen.current = last.id;
    if (!enabled || last.user_id === uid) return;
    setShown({ id: last.id, text: `👁 ${last.name}: ${last.body}` });
    const t = setTimeout(() => setShown((s) => (s?.id === last.id ? null : s)), TOAST_MS);
    return () => clearTimeout(t);
  }, [last, uid, enabled]);
  return enabled ? shown?.text ?? null : null;
}

/** Messages that arrived since the panel was last opened (not mine). */
export function useUnread(messages: SpectatorMessage[], uid: string, open: boolean) {
  const [readUpTo, setReadUpTo] = useState<number>(() => messages.at(-1)?.id ?? 0);
  const newest = messages.at(-1)?.id ?? 0;
  useEffect(() => {
    if (open) setReadUpTo(newest);
  }, [open, newest]);
  return messages.filter((m) => m.id > readUpTo && m.user_id !== uid).length;
}

export function SpectatorsSheet({ watchers, uid, listeners, messages, onSend, player, onClose }: {
  watchers: Watcher[]; uid: string;
  /** Watchers listening to the voice right now (players see it). */
  listeners?: Set<string>;
  messages: SpectatorMessage[];
  /** Spectators only: say something to the table. */
  onSend?: (text: string) => Promise<void>;
  /** Players only: my choices. */
  player?: { hear: boolean; onHear: (v: boolean) => void; showMessages: boolean; onShowMessages: (v: boolean) => void };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!onSend || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text);
      setText('');
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} className="spec-sheet">
      <h2>👁 {t.spec.title} · {watchers.length}</h2>
      {watchers.length === 0 ? <p className="fine">{t.spec.none}</p> : (
        <div className="spec-watchers">
          {watchers.map((w) => (
            <span key={w.id} className="spec-chip">
              {w.name}{w.id === uid ? ` (${t.spec.you})` : ''}
              {listeners?.has(w.id) && <span title={t.spec.listening} aria-label={t.spec.listening}> 🎧</span>}
            </span>
          ))}
        </div>
      )}
      {player && (
        <>
          <label className="setting-row push-row">
            <span>🎧 {t.spec.hear}<small>{t.spec.hearHint}</small></span>
            <input type="checkbox" checked={player.hear} onChange={(e) => player.onHear(e.target.checked)} />
          </label>
          {listeners && listeners.size > 0 && <small className="fine left">{t.spec.hearCount.replace('{n}', String(listeners.size))}</small>}
          <label className="setting-row push-row">
            <span>💬 {t.spec.showMessages}</span>
            <input type="checkbox" checked={player.showMessages} onChange={(e) => player.onShowMessages(e.target.checked)} />
          </label>
        </>
      )}
      <span className="label">{t.spec.messages}</span>
      <div className="spec-messages" ref={list}>
        {messages.length === 0 ? <p className="fine">{t.spec.noMessages}</p> : messages.map((m) => (
          <p key={m.id} className={m.user_id === uid ? 'mine' : ''}><b>{m.name}</b> {m.body}</p>
        ))}
      </div>
      {onSend && (
        <form className="spec-form" onSubmit={send}>
          <input className="text-input" maxLength={80} placeholder={t.spec.chatPh} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" disabled={busy || !text.trim()}>{t.spec.send}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

/** A spectator's voice control: listen to the players (never talk). Hidden where the table has no voice. */
export function ListenButton({ voice }: { voice: Voice }) {
  const { t } = useI18n();
  if (voice.status === 'unavailable') return null;
  if (voice.needsTap) return <button className="voice-pill hear pulse" onClick={voice.enableAudio}><SpeakerHighIcon size={22} />{t.voice.tapToHear}</button>;
  if (voice.status === 'on') {
    return <button className="voice-pill live" onClick={voice.leave} title={t.spec.stopListening}><HeadphonesIcon size={22} weight="fill" />{t.spec.listeningNow}</button>;
  }
  const connecting = voice.status === 'connecting';
  return (
    <button className="voice-pill join" onClick={voice.join} disabled={connecting}>
      {connecting ? <><CircleNotchIcon size={22} />{t.voice.connecting}</>
        : voice.status === 'error' ? <><WarningCircleIcon size={22} />{t.voice.retry}</>
        : <><HeadphonesIcon size={22} />{t.spec.listen}</>}
    </button>
  );
}

/** Settings: may spectators hear my voice? (On unless turned off.) */
export function SpectatorsHearRow({ initial }: { initial: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async (v: boolean) => {
    setBusy(true);
    setOn(v);
    const { error } = await supabase.rpc('set_spectators_hear', { p_on: v });
    if (error) setOn(!v);
    setBusy(false);
  };
  return (
    <label className="setting-row push-row">
      <span>🎧 {t.spec.hear}<small>{t.spec.hearHint}</small></span>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
    </label>
  );
}

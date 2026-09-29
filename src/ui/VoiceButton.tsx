import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Voice } from '../lib/useVoice';
import { Sheet } from './MainScreen';
import { MicrophoneIcon, MicrophoneSlashIcon, SpeakerHighIcon, WarningCircleIcon, CircleNotchIcon } from '@phosphor-icons/react';

const HOLD_MS = 300;

/**
 * The table's voice chat in one labelled button.
 *   Off → "Voz" (glows when others at the table are already on) — tap to join, mic opens.
 *   On  → "Abierto" / "Callado" — tap to mute or unmute; while muted, hold to talk.
 *   Mic refused → "Permitir mic" — tap to ask again; if still refused, how to allow it.
 * With my voice on air (`air` = how many by link may hear me), a red "Al aire" badge on it.
 */
export function VoiceButton({ voice, me, others = 0, air = null }: { voice: Voice; me?: string; others?: number; air?: number | null }) {
  const { t } = useI18n();
  const pressedAt = useRef(0);
  const pushing = useRef(false);
  const [help, setHelp] = useState(false);

  if (voice.status === 'unavailable') return null;

  const helpSheet = help && (
    <Sheet onClose={() => setHelp(false)} className="mic-help">
      <h2><MicrophoneIcon size={24} /> {t.voice.helpTitle}</h2>
      <p className="fine">{t.voice.helpWhy}</p>
      <ul className="mic-steps">
        <li><b>iPhone</b> · {t.voice.helpIos}</li>
        <li><b>Android</b> · {t.voice.helpAndroid}</li>
      </ul>
      <button className="btn primary wide" onClick={async () => { if (await voice.setMic(true)) setHelp(false); }}>{t.voice.tryAgain}</button>
    </Sheet>
  );

  if (voice.needsTap) {
    return <button className="voice-pill hear pulse" onClick={voice.enableAudio}><SpeakerHighIcon size={24} />{t.voice.tapToHear}</button>;
  }

  if (voice.status !== 'on') {
    const connecting = voice.status === 'connecting';
    return (
      <button className={`voice-pill join ${others > 0 && !connecting ? 'pulse' : ''}`} onClick={voice.join} disabled={connecting}
        title={voice.status === 'error' ? t.voiceError : t.voiceJoin}>
        {connecting ? <><CircleNotchIcon size={24} />{t.voice.connecting}</> : voice.status === 'error' ? <><WarningCircleIcon size={24} />{t.voice.retry}</> : <><MicrophoneIcon size={24} />{t.voice.join}</>}
        {others > 0 && !connecting && <span className="vp-count">{others}</span>}
      </button>
    );
  }

  if (voice.micBlocked) {
    return (
      <>
        <button className="voice-pill blocked" onClick={async () => { if (!(await voice.setMic(true))) setHelp(true); }}>
          <MicrophoneIcon size={24} />{t.voice.allowMic}
        </button>
        {helpSheet}
      </>
    );
  }

  const down = () => {
    pressedAt.current = Date.now();
    if (!voice.micOn) {
      // Might become push-to-talk; open the mic right away so no words are lost.
      pushing.current = true;
      voice.setMic(true);
    }
  };
  const up = () => {
    const held = Date.now() - pressedAt.current >= HOLD_MS;
    if (pushing.current) {
      pushing.current = false;
      if (held) voice.setMic(false); // released push-to-talk → muted again
      return; // a short tap while muted just unmuted
    }
    if (!held) voice.setMic(false); // short tap while live → mute
  };
  const talking = !!me && voice.micOn && voice.speaking.has(me);
  const onAir = air !== null && (
    <span className="vp-air" title={t.voice.onAirHint} aria-label={t.voice.onAirHint}>{t.voice.onAir}{air > 0 ? ` · ${air}` : ''}</span>
  );

  return (
    <>
      <button
        className={`voice-pill ${voice.micOn ? 'live' : 'muted'} ${talking ? 'talking' : ''}`}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={() => pushing.current && up()}
        onPointerCancel={() => pushing.current && up()}
        onClick={(e) => { if (e.detail === 0) void voice.setMic(!voice.micOn); }}
        onContextMenu={(e) => e.preventDefault()}
        title={voice.micOn ? t.mute : t.holdToTalk}
      >
        {voice.micOn ? <><MicrophoneIcon size={24} />{t.voice.live}</> : <><MicrophoneSlashIcon size={24} />{t.voice.muted}</>}
        {onAir}
      </button>
      {helpSheet}
    </>
  );
}

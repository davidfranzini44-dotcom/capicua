import { LocalAudioTrack, Room, RoomEvent, Track, type Participant, type RemoteParticipant } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { micLeveler } from './micLeveler';
import { api, ApiError } from './supabase';

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'error' | 'unavailable';

/** Spectators join as `spec-<user id>`, listening only. */
export const SPECTATOR_PREFIX = 'spec-';
const isSpectator = (identity: string) => identity.startsWith(SPECTATOR_PREFIX);

export interface VoiceOptions {
  /** Watching this friend's game: join their voice room, listening only. */
  watching?: string;
  /** A player: may spectators hear me? (Enforced here, on my own published tracks.) */
  spectatorsHear?: boolean;
}

/**
 * Table voice chat over LiveKit. The `game` edge function decides who hears
 * whom (whole table in custom and tournament rooms, teammates only in public
 * 2v2, nobody in public 1v1/ffa) and hands talking tokens only to people
 * seated at the table; a watching friend gets a listen-only one. Participant
 * identity = Supabase user id (spectators: `spec-<id>`).
 */
export function useVoice(roomId: string | null, opts: VoiceOptions = {}) {
  const room = useRef<Room | null>(null);
  const hearRef = useRef(opts.spectatorsHear ?? true);
  /** Spectators listening right now (user ids), for the players to see. */
  const [listeners, setListeners] = useState<Set<string>>(new Set());
  /** I'm a spectator: no mic, ever. */
  const [listenOnly, setListenOnly] = useState(false);
  /** Made on the tap that joins (a user gesture), so it's allowed to run; feeds the mic leveler. */
  const audioCtx = useRef<AudioContext | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('off');
  const [micOn, setMicOn] = useState(false);
  /** The browser (or the player) refused the microphone: we're on voice, listening only. */
  const [micBlocked, setMicBlocked] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  /** Browsers (iOS especially) may block playback until a tap. */
  const [needsTap, setNeedsTap] = useState(false);

  const reset = useCallback(() => {
    room.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setStatus((s) => (s === 'unavailable' ? s : 'off'));
    setMicOn(false);
    setMicBlocked(false);
    setSpeaking(new Set());
    setNeedsTap(false);
    setListeners(new Set());
    setListenOnly(false);
  }, []);

  /**
   * Who may subscribe to my voice: everyone, or — if I turned spectators off —
   * only the other players. LiveKit enforces it on the server for my tracks.
   */
  const applyPermissions = useCallback((r: Room) => {
    if (!r.localParticipant.permissions?.canPublish) return;
    const others = [...r.remoteParticipants.values()];
    setListeners(new Set(others.filter((p) => isSpectator(p.identity)).map((p) => p.identity.slice(SPECTATOR_PREFIX.length))));
    if (hearRef.current) r.localParticipant.setTrackSubscriptionPermissions(true);
    else {
      r.localParticipant.setTrackSubscriptionPermissions(false,
        others.filter((p) => !isSpectator(p.identity)).map((p) => ({ participantIdentity: p.identity, allowAll: true })));
    }
  }, []);

  /** Quiet talkers get levelled up before they're sent (see micLeveler). Skipped if the browser can't. */
  const levelMic = useCallback(async (r: Room) => {
    const ctx = audioCtx.current;
    const track = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!ctx || !(track instanceof LocalAudioTrack) || track.getProcessor()) return;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return; // a paused context would send silence
    try {
      track.setAudioContext(ctx);
      await track.setProcessor(micLeveler());
    } catch (e) {
      console.warn('mic leveler unavailable', e);
    }
  }, []);

  /** Opens the mic. False if the browser refused it (we stay on voice, listening). */
  const openMic = useCallback(async (r: Room) => {
    try {
      await r.localParticipant.setMicrophoneEnabled(true);
      setMicOn(true);
      setMicBlocked(false);
      await levelMic(r);
      return true;
    } catch {
      setMicOn(false);
      setMicBlocked(true);
      return false;
    }
  }, [levelMic]);

  const join = useCallback(async () => {
    if (!roomId || room.current) return;
    setStatus('connecting');
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audioCtx.current) {
        audioCtx.current = new Ctx();
        audioCtx.current.resume().catch(() => {});
      }
    } catch { /* no Web Audio: voice still works, just without levelling */ }
    try {
      const { url, token, listenOnly: listening } = await api<{ url: string; token: string; listenOnly?: boolean }>(
        'voice_token', { roomId, watching: opts.watching });
      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const el = track.attach();
        el.dataset.voice = '1';
        document.body.appendChild(el);
      })
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.ActiveSpeakersChanged, (ps: Participant[]) => setSpeaking(new Set(ps.map((p) => p.identity))))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!r.canPlaybackAudio))
        .on(RoomEvent.ParticipantConnected, () => applyPermissions(r))
        .on(RoomEvent.ParticipantDisconnected, () => applyPermissions(r))
        .on(RoomEvent.Disconnected, reset);
      await r.connect(url, token);
      room.current = r;
      setNeedsTap(!r.canPlaybackAudio);
      setStatus('on');
      if (listening) {
        setListenOnly(true);
        return;
      }
      applyPermissions(r);
      await openMic(r);
      applyPermissions(r);
    } catch (e) {
      room.current?.disconnect();
      room.current = null;
      setStatus(e instanceof ApiError && (e.code === 'voice_not_configured' || e.code === 'voice_disabled') ? 'unavailable' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, opts.watching, reset, openMic, applyPermissions]);

  // The player changed "spectators can hear me": apply it now.
  useEffect(() => {
    hearRef.current = opts.spectatorsHear ?? true;
    if (room.current) applyPermissions(room.current);
  }, [opts.spectatorsHear, applyPermissions]);

  const leave = useCallback(() => {
    room.current?.disconnect();
    reset();
  }, [reset]);

  /** Mute / unmute. Unmuting after the browser refused the mic asks again; false if it's still refused. */
  const setMic = useCallback(async (on: boolean) => {
    const r = room.current;
    if (!r || listenOnly) return false;
    if (on && micBlocked) return openMic(r);
    await r.localParticipant.setMicrophoneEnabled(on);
    setMicOn(on);
    if (on) await levelMic(r);
    return true;
  }, [micBlocked, openMic, levelMic, listenOnly]);

  const enableAudio = useCallback(() => {
    audioCtx.current?.resume().catch(() => {});
    room.current?.startAudio().then(() => setNeedsTap(false));
  }, []);

  /** Mute/unmute one other player, for me only. */
  const togglePeer = useCallback((identity: string) => {
    const p = room.current?.remoteParticipants.get(identity) as RemoteParticipant | undefined;
    setMutedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      p?.setVolume(next.has(identity) ? 0 : 1);
      return next;
    });
  }, []);

  // Phones pause audio when the app goes to the background or a call comes in; the
  // levelled mic would then send silence, so wake it up when the player is back.
  useEffect(() => {
    const wake = () => {
      const ctx = audioCtx.current;
      if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);

  // Leave the call when the table closes.
  useEffect(() => () => {
    room.current?.disconnect();
    audioCtx.current?.close().catch(() => {});
  }, [roomId]);

  return { status, micOn, micBlocked, speaking, mutedPeers, needsTap, listeners, listenOnly, join, leave, setMic, enableAudio, togglePeer };
}

export type Voice = ReturnType<typeof useVoice>;

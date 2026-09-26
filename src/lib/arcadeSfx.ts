// Arcade power sounds, synthesized with Web Audio: Cambio (a swap whoosh),
// Doble golpe (a punchy hit), Comodín (a shimmer) and Candado (a padlock
// snapping shut). They follow the same "Sonidos" table switch as the other
// table sounds (src/lib/sfx.ts), and stay quiet when the page is hidden.

import type { Power } from '../../supabase/functions/_shared/domino.ts';
import { sfxOn } from './sfx';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!sfxOn() || typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx();
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Phones keep sound locked until a tap (and may lock it again after the background).
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { if (ctx) audio(); }, { capture: true, passive: true });
}

function env(c: BaseAudioContext, dest: AudioNode, t0: number, peak: number, attack: number, decay: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(dest);
  return g;
}

function tone(c: BaseAudioContext, dest: AudioNode, o: { t0: number; freq: number; to?: number; dur: number; peak: number; type?: OscillatorType; attack?: number; vibrato?: number }) {
  const osc = c.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(o.freq, o.t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
  if (o.vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 7;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.t0);
    lfo.stop(o.t0 + o.dur + 0.05);
  }
  osc.connect(env(c, dest, o.t0, o.peak, o.attack ?? 0.004, o.dur));
  osc.start(o.t0);
  osc.stop(o.t0 + (o.attack ?? 0.004) + o.dur + 0.05);
}

function hiss(c: BaseAudioContext, dest: AudioNode, o: { t0: number; dur: number; peak: number; filter: BiquadFilterType; freq: number; to?: number; q?: number }) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.freq, o.t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
  f.Q.value = o.q ?? 1;
  src.connect(f).connect(env(c, dest, o.t0, o.peak, 0.002, o.dur));
  src.start(o.t0, Math.random() * 0.5);
  src.stop(o.t0 + o.dur + 0.05);
}

const SOUNDS: Record<Power, (c: BaseAudioContext, dest: AudioNode, t: number) => void> = {
  // Two fichas trading places: a quick up-and-down whoosh.
  cambio: (c, d, t) => {
    hiss(c, d, { t0: t, dur: 0.24, peak: 0.45, filter: 'bandpass', freq: 600, to: 2800, q: 1.2 });
    tone(c, d, { t0: t, freq: 330, to: 660, dur: 0.12, peak: 0.16, type: 'sine' });
    tone(c, d, { t0: t + 0.13, freq: 660, to: 330, dur: 0.12, peak: 0.16, type: 'sine' });
  },
  // Two at once: a deep punch under the clacks.
  doble: (c, d, t) => {
    tone(c, d, { t0: t, freq: 160, to: 55, dur: 0.22, peak: 0.7, type: 'sine', attack: 0.002 });
    hiss(c, d, { t0: t, dur: 0.08, peak: 0.45, filter: 'lowpass', freq: 1800 });
    tone(c, d, { t0: t + 0.02, freq: 880, dur: 0.08, peak: 0.1, type: 'square' });
  },
  // A ficha turning into another number: a little magic shimmer.
  comodin: (c, d, t) => {
    [1319, 1568, 1976, 2637].forEach((f, i) => tone(c, d, { t0: t + i * 0.05, freq: f, dur: 0.18, peak: 0.09, type: 'sine' }));
    tone(c, d, { t0: t, freq: 523, to: 1047, dur: 0.3, peak: 0.14, vibrato: 12 });
  },
  // An end closing: a padlock snapping shut.
  candado: (c, d, t) => {
    hiss(c, d, { t0: t, dur: 0.03, peak: 0.8, filter: 'highpass', freq: 3000 });
    tone(c, d, { t0: t + 0.03, freq: 1400, to: 900, dur: 0.05, peak: 0.3, type: 'square', attack: 0.001 });
    tone(c, d, { t0: t + 0.09, freq: 220, to: 160, dur: 0.1, peak: 0.45, type: 'triangle', attack: 0.002 });
  },
};

/** A power earned: a bright little two-note "ding". */
export function playEarnSfx(delay = 0) {
  if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push('earn');
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = audio();
  if (!c || !out) return;
  try {
    const t = c.currentTime + 0.01 + delay / 1000;
    tone(c, out, { t0: t, freq: 988, dur: 0.1, peak: 0.12, type: 'sine' });
    tone(c, out, { t0: t + 0.09, freq: 1480, dur: 0.22, peak: 0.12, type: 'sine' });
  } catch { /* stay quiet */ }
}

/** Play a power's sound now (or after `delay` ms). */
export function playPowerSfx(power: Power, delay = 0) {
  if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push(power);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = audio();
  if (!c || !out) return;
  try {
    SOUNDS[power](c, out, c.currentTime + 0.01 + delay / 1000);
  } catch { /* an old browser missing a Web Audio feature: stay quiet */ }
}

/** Build a power's sound into any graph (used to check the sounds offline). */
export const schedulePowerSfx = (power: Power, c: BaseAudioContext, dest: AudioNode, t: number) => SOUNDS[power](c, dest, t);

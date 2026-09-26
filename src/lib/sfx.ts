// Table sound effects, synthesized with Web Audio (no files to download or
// license): a ficha clacking on wood, the knock for a pass, drawing from the
// pile, capicúa and pase corrido fanfares, and winning / losing the game.
// Players can turn them off in the table menu (remembered per device).

import { useState } from 'react';
import type { Sfx } from './tableFx';

const KEY = 'capicua.sfx';

let enabled = (() => {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } // on unless turned off
})();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!ctx) {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers keep sound locked until the player touches the page, and phones can
// lock it again after the app was in the background: every tap unlocks it.
if (typeof window !== 'undefined') {
  const unlock = () => { if (enabled) audio(); };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

function noise(c: BaseAudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Where the sound being built goes (the speakers, or an offline render in checks). */
let out: AudioNode | null = null;

/** A gain that rises to `peak` in `attack` s and fades out over `decay` s. */
function envelope(c: BaseAudioContext, t0: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(out!);
  return g;
}

function tone(c: BaseAudioContext, o: {
  t0: number; freq: number; to?: number; dur: number; peak: number; type?: OscillatorType; attack?: number; vibrato?: number;
}) {
  const osc = c.createOscillator();
  osc.type = o.type ?? 'triangle';
  osc.frequency.setValueAtTime(o.freq, o.t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
  if (o.vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.t0);
    lfo.stop(o.t0 + o.dur + 0.05);
  }
  osc.connect(envelope(c, o.t0, o.peak, o.attack ?? 0.005, o.dur));
  osc.start(o.t0);
  osc.stop(o.t0 + (o.attack ?? 0.005) + o.dur + 0.05);
}

function hiss(c: BaseAudioContext, o: { t0: number; dur: number; peak: number; filter: BiquadFilterType; freq: number; to?: number; q?: number }) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.freq, o.t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
  f.Q.value = o.q ?? 1;
  src.connect(f).connect(envelope(c, o.t0, o.peak, 0.002, o.dur));
  src.start(o.t0, Math.random() * 0.5);
  src.stop(o.t0 + o.dur + 0.05);
}

const jitter = () => 0.92 + Math.random() * 0.16;

const SOUNDS: Record<Sfx, (c: BaseAudioContext, t: number) => void> = {
  // A ficha set down on the wooden table: a sharp click and a short knock of body.
  tile: (c, t) => {
    const j = jitter();
    hiss(c, { t0: t, dur: 0.045, peak: 0.9, filter: 'bandpass', freq: 2600 * j, q: 1.4 });
    tone(c, { t0: t, freq: 230 * j, to: 130 * j, dur: 0.07, peak: 0.45, attack: 0.002 });
  },
  // Passing: knuckles on the table twice ("toc toc").
  knock: (c, t) => {
    for (const d of [0, 0.14]) {
      tone(c, { t0: t + d, freq: 125, to: 80, dur: 0.1, peak: 0.7, type: 'sine', attack: 0.003 });
      hiss(c, { t0: t + d, dur: 0.05, peak: 0.25, filter: 'lowpass', freq: 900 });
    }
  },
  // Drawing from the pile: a tile sliding across the felt.
  draw: (c, t) => hiss(c, { t0: t, dur: 0.2, peak: 0.6, filter: 'bandpass', freq: 1200, to: 3200, q: 0.7 }),
  // Pase corrido: a quick "ta-da".
  paseCorrido: (c, t) => {
    tone(c, { t0: t, freq: 784, dur: 0.1, peak: 0.22 });
    tone(c, { t0: t + 0.11, freq: 1047, dur: 0.35, peak: 0.24 });
    tone(c, { t0: t + 0.11, freq: 1319, dur: 0.3, peak: 0.1, type: 'sine' });
  },
  // Capicúa: a bright run up and a ringing chord with sparkles.
  capicua: (c, t) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, { t0: t + i * 0.07, freq: f, dur: 0.12, peak: 0.2 }));
    for (const f of [1047, 1319, 1568]) tone(c, { t0: t + 0.36, freq: f, dur: 0.7, peak: 0.12, vibrato: 4 });
    [2093, 2637, 3136].forEach((f, i) => tone(c, { t0: t + 0.4 + i * 0.09, freq: f, dur: 0.12, peak: 0.06, type: 'sine' }));
  },
  // Won the game: a short fanfare ending on a big chord.
  win: (c, t) => {
    [392, 523, 659, 784].forEach((f, i) => tone(c, { t0: t + i * 0.13, freq: f, dur: 0.14, peak: 0.22, type: 'square', attack: 0.01 }));
    for (const f of [523, 659, 784, 1047]) tone(c, { t0: t + 0.55, freq: f, dur: 1.1, peak: 0.1, type: 'square', attack: 0.02, vibrato: 5 });
    [2093, 2637, 3136, 2637].forEach((f, i) => tone(c, { t0: t + 0.6 + i * 0.12, freq: f, dur: 0.14, peak: 0.05, type: 'sine' }));
  },
  // Second place (free-for-all): a pleasant little chime.
  second: (c, t) => {
    [523, 659, 784].forEach((f, i) => tone(c, { t0: t + i * 0.11, freq: f, dur: 0.18, peak: 0.16 }));
  },
  // Lost the game: the sad trombone, "wah wah wah waaah".
  lose: (c, t) => {
    [392, 370, 349].forEach((f, i) => tone(c, { t0: t + i * 0.36, freq: f, dur: 0.3, peak: 0.24, type: 'sawtooth', attack: 0.03 }));
    tone(c, { t0: t + 1.08, freq: 330, to: 311, dur: 0.95, peak: 0.24, type: 'sawtooth', attack: 0.03, vibrato: 7 });
  },
};

/** Play a sound now (or after `delay` ms). Silent when turned off, hidden, or unsupported. */
export function playSfx(name: Sfx, delay = 0) {
  if (import.meta.env.DEV) ((window as unknown as { __sfxLog?: string[] }).__sfxLog ??= []).push(name);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const c = audio();
  if (!c || !master) return;
  try {
    scheduleSfx(name, c, master, c.currentTime + 0.01 + delay / 1000);
  } catch { /* an old browser missing a Web Audio feature: stay quiet */ }
}

/** Build a sound into any audio graph at time `t` (also used to check the sounds offline). */
export function scheduleSfx(name: Sfx, c: BaseAudioContext, destination: AudioNode, t: number) {
  out = destination;
  SOUNDS[name](c, t);
}

export const sfxOn = () => enabled;

/** The "Sonidos" switch: on unless the player turned it off on this device. */
export function useSfxPref(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(enabled);
  const set = (v: boolean) => {
    enabled = v;
    setOn(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage unavailable */ }
    if (v) playSfx('tile');
    else ctx?.suspend().catch(() => {});
  };
  return [on, set];
}

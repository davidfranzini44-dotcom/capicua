// Rebuild the original table effects in public/sounds/sfx.
// All clips are synthesized here, so they have no third-party audio license.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RATE = 24_000;
const TAU = Math.PI * 2;
const output = join(dirname(fileURLToPath(import.meta.url)), '../public/sounds/sfx');
mkdirSync(output, { recursive: true });

let seed = 0x51c0ffee;
function random() {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 0x1_0000_0000;
}
const clip = (seconds) => new Float64Array(Math.ceil(seconds * RATE));

function impact(buf, at, strength = 1, variation = 0) {
  const start = Math.round(at * RATE);
  const modes = [187, 367, 694, 1152, 2030, 3210].map((f, i) => f * (1 + variation * (i % 2 ? 0.035 : -0.025)));
  let low = 0;
  for (let n = 0; n < Math.min(buf.length - start, RATE * 0.19); n++) {
    const t = n / RATE;
    const white = random() * 2 - 1;
    low += 0.22 * (white - low);
    const snap = (white - low) * Math.exp(-t * 125) * 0.58;
    const body = modes.reduce((sum, f, i) => sum +
      Math.sin(TAU * f * t + i * 0.8) * Math.exp(-t * (38 + i * 17)) * [0.22, 0.25, 0.19, 0.14, 0.10, 0.06][i], 0);
    buf[start + n] += strength * (snap + body);
  }
}

function knock(buf, at, strength = 1, shade = 0) {
  const start = Math.round(at * RATE);
  let low = 0;
  for (let n = 0; n < Math.min(buf.length - start, RATE * 0.17); n++) {
    const t = n / RATE;
    low += 0.075 * ((random() * 2 - 1) - low);
    const wood = Math.sin(TAU * (111 + shade) * t) * Math.exp(-t * 34) * 0.43
      + Math.sin(TAU * (248 + shade * 2) * t) * Math.exp(-t * 47) * 0.20;
    buf[start + n] += strength * (wood + low * Math.exp(-t * 90) * 1.3);
  }
}

function scrape(buf, at, length, strength = 1) {
  const start = Math.round(at * RATE);
  let low = 0;
  let slow = 0;
  for (let n = 0; n < Math.min(buf.length - start, length * RATE); n++) {
    const t = n / RATE;
    const x = random() * 2 - 1;
    low += 0.24 * (x - low);
    slow += 0.018 * (x - slow);
    const grit = low - slow;
    const envelope = Math.sin(Math.PI * t / length) ** 0.55;
    const ridges = 0.72 + 0.18 * Math.sin(TAU * 39 * t) + 0.10 * Math.sin(TAU * 67 * t);
    buf[start + n] += grit * envelope * ridges * strength * 0.31;
  }
}

// A soft wooden-bar chime, with a quick strike and decaying inharmonic overtones.
function note(buf, at, frequency, length, strength = 1, brightness = 1) {
  const start = Math.round(at * RATE);
  for (let n = 0; n < Math.min(buf.length - start, length * RATE); n++) {
    const t = n / RATE;
    const fundamental = Math.sin(TAU * frequency * t) * Math.exp(-t * 5.2) * 0.65;
    const partial = Math.sin(TAU * frequency * 2.01 * t) * Math.exp(-t * 9.4) * 0.23;
    const shine = Math.sin(TAU * frequency * 3.92 * t) * Math.exp(-t * 16) * 0.12 * brightness;
    const attack = Math.min(1, t * 900);
    buf[start + n] += strength * attack * (fundamental + partial + shine);
  }
}

function shaker(buf, at, length, strength = 1) {
  const start = Math.round(at * RATE);
  let low = 0;
  for (let n = 0; n < Math.min(buf.length - start, length * RATE); n++) {
    const t = n / RATE;
    const x = random() * 2 - 1;
    low += 0.09 * (x - low);
    buf[start + n] += strength * (x - low) * Math.exp(-t * 32) * 0.14;
  }
}

function save(name, samples) {
  const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  const scale = max > 0 ? 0.82 / max : 1;
  const pcm = Buffer.alloc(44 + samples.length * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample * scale)) * 32767), 44 + i * 2));
  writeFileSync(join(output, `${name}.wav`), pcm);
}

for (let i = 0; i < 4; i++) {
  const tile = clip(0.23);
  impact(tile, 0.006, 1, (i - 1.5) / 3);
  impact(tile, 0.037 + i * 0.003, 0.18 + i * 0.015, i / 5);
  save(`tile-${i + 1}`, tile);
}
for (let i = 0; i < 3; i++) {
  const pass = clip(0.35);
  knock(pass, 0.009, 0.9, i * 4);
  knock(pass, 0.143 + i * 0.008, 0.72, i * 6 + 3);
  save(`knock-${i + 1}`, pass);
}
for (let i = 0; i < 3; i++) {
  const draw = clip(0.34);
  scrape(draw, 0.009, 0.18 + i * 0.018, 0.8);
  impact(draw, 0.20 + i * 0.018, 0.3, i / 5);
  save(`draw-${i + 1}`, draw);
}

const pase = clip(0.72);
knock(pase, 0.006, 0.52);
knock(pase, 0.11, 0.6);
note(pase, 0.13, 587.33, 0.35, 0.43);
note(pase, 0.26, 783.99, 0.41, 0.48);
note(pase, 0.37, 1174.66, 0.33, 0.36);
save('paseCorrido', pase);

const capicua = clip(1.28);
impact(capicua, 0.005, 0.69);
impact(capicua, 0.097, 0.58, 0.12);
[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(capicua, 0.18 + i * 0.13, f, 0.49, 0.46));
note(capicua, 0.70, 1046.5, 0.54, 0.44);
note(capicua, 0.70, 1318.5, 0.54, 0.33);
note(capicua, 0.70, 1567.98, 0.54, 0.28);
shaker(capicua, 0.71, 0.15, 0.4);
save('capicua', capicua);

const win = clip(1.48);
[392, 523.25, 659.25, 783.99].forEach((f, i) => {
  note(win, 0.02 + i * 0.16, f, 0.60, 0.42);
  shaker(win, 0.02 + i * 0.16, 0.07, 0.5);
});
[523.25, 659.25, 783.99, 1046.5].forEach((f) => note(win, 0.72, f, 0.72, 0.35));
save('win', win);

const second = clip(0.76);
[523.25, 659.25, 783.99].forEach((f, i) => note(second, 0.015 + i * 0.16, f, 0.45, 0.5));
save('second', second);

const lose = clip(0.92);
[392, 349.23, 293.66].forEach((f, i) => {
  knock(lose, 0.015 + i * 0.21, 0.35, -i * 3);
  note(lose, 0.02 + i * 0.21, f, 0.46, 0.31, 0.3);
});
save('lose', lose);

console.log(`Wrote 15 sound clips to ${output}`);

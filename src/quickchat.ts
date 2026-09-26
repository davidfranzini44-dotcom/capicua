// Sound buttons: short table talk anyone can fire off.
// Drop recorded clips in public/sounds/<id>.mp3 and list the id in RECORDED;
// until then the phrase is read out with the device's text-to-speech.

export const PHRASES = {
  dale: { es: '¡Dale, que es pa\' hoy!', en: "Hurry up, it's for today!" },
  capicua: { es: '¡Capicúa!', en: 'Capicúa!' },
  tranque: { es: '¡Tranque, tranque!', en: 'Blocked, blocked!' },
  nollevas: { es: '¿Tú no llevas?', en: 'Got nothing?' },
  buena: { es: '¡Buena, compai!', en: 'Nice one, partner!' },
  tate: { es: '¡Tate quieto!', en: 'Easy there!' },
  aymadre: { es: '¡Ay mi madre!', en: 'Oh my god!' },
  pollona: { es: '¡Pollona!', en: 'Shutout!' },
} as const;

export type PhraseId = keyof typeof PHRASES;
export const PHRASE_IDS = Object.keys(PHRASES) as PhraseId[];

/** Ids with a recorded clip in public/sounds. */
const RECORDED = new Set<PhraseId>([]);

/** Seconds a phrase bubble stays over a seat. */
export const BUBBLE_MS = 2800;
/** Minimum gap between a player's own sound buttons. */
export const COOLDOWN_MS = 2500;

/** Sounds on/off — a per-device preference from the settings sheet. */
let muted = (() => {
  try { return localStorage.getItem('capicua.sound') === '0'; } catch { return false; }
})();
export const isSoundOn = () => !muted;
export function setSoundOn(on: boolean) {
  muted = !on;
  try { localStorage.setItem('capicua.sound', on ? '1' : '0'); } catch { /* storage unavailable */ }
}

let esVoice: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  if (esVoice !== undefined) return esVoice;
  const voices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  if (voices.length === 0) return null; // not loaded yet — try again next time
  esVoice =
    voices.find((v) => v.lang === 'es-DO') ??
    voices.find((v) => v.lang === 'es-US') ??
    voices.find((v) => v.lang.startsWith('es')) ??
    null;
  return esVoice;
}

/** Plays a phrase. `seat` shifts the pitch so each chair sounds like a different person. */
export function playPhrase(id: PhraseId, seat: number) {
  if (muted) return;
  if (RECORDED.has(id)) {
    const audio = new Audio(`/sounds/${id}.mp3`);
    audio.play().catch(() => {});
    return;
  }
  if (typeof speechSynthesis === 'undefined') return;
  const u = new SpeechSynthesisUtterance(PHRASES[id].es.replace(/[¡!¿?]/g, ''));
  u.lang = 'es-US';
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.1;
  u.pitch = [1, 0.75, 1.35, 0.9][seat % 4];
  speechSynthesis.speak(u);
}

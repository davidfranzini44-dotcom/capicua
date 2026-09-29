// Who is who in a table's voice room, and who may hear a player. Identities: players are their
// user id; friends watching are `spec-<user id>`; people watching by link are `air-…` (opaque,
// made by the server: share_air_identity in migration 20261012000000_share_voice).

export const SPECTATOR_PREFIX = 'spec-';
export const AIR_PREFIX = 'air-';
export const isSpectator = (identity: string) => identity.startsWith(SPECTATOR_PREFIX);
export const isAirListener = (identity: string) => identity.startsWith(AIR_PREFIX);

/** A player's "Mi voz al aire": on or off, and the link listeners the server lists right now. */
export interface AirAccess {
  on: boolean;
  listeners: string[];
  /** Ask the server again (someone by link just joined the voice room). */
  refresh?: () => void;
}
export const AIR_OFF: AirAccess = { on: false, listeners: [] };

/**
 * Who may subscribe to my voice: everyone at the table; friends watching unless I turned that
 * off; people watching by link only at a private table (`airRoom`), only if I put my voice on
 * air, and only those the server lists. Wherever link listeners can be in the room the answer
 * is an explicit list — "everyone" would let them in too.
 */
export function voiceSubscribers(present: string[], o: { spectatorsHear: boolean; airRoom: boolean; air: AirAccess }): 'all' | string[] {
  if (!o.airRoom && o.spectatorsHear) return 'all';
  const players = present.filter((id) => !isSpectator(id) && !isAirListener(id));
  const spectators = o.spectatorsHear ? present.filter(isSpectator) : [];
  const air = o.airRoom && o.air.on ? o.air.listeners.filter(isAirListener) : [];
  return [...new Set([...players, ...spectators, ...air])];
}

/** A link viewer plays only the players who put their voice on air. */
export function airVoices(onAirSeats: readonly number[], seats: readonly { seat: number; user_id: string | null; is_bot: boolean }[]): string[] {
  return seats.filter((s) => onAirSeats.includes(s.seat) && s.user_id && !s.is_bot).map((s) => s.user_id!);
}

// Remembers which table this browser was sitting at, so a refresh, a closed
// tab, or a dead phone battery lands the player back in their game.
// The server is still the source of truth (queue_status / activeRoomOf);
// this only decides where the app opens.

const KEY = 'capicua.table';

export function rememberTable(roomId: string) {
  try { localStorage.setItem(KEY, roomId); } catch { /* storage unavailable */ }
}

export function lastTable(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function forgetTable() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

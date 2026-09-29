// The share link for the game a player is at (see ShareMatchSheet): made on demand, kept
// while the table is open, turned off on request. It belongs to one game — after a rematch
// the state starts over, and the old link has stopped working on the server anyway.
import { useCallback, useState } from 'react';
import { activeShareLinks, createShareLink, revokeShareLink, ShareError, type ShareErrorCode, type ShareLink } from './shareMatch';

interface State {
  /** The game this state is about; anything else is stale. */
  game: string | null;
  link: ShareLink | null;
  error: ShareErrorCode | null;
  revoked: boolean;
  /** Other links still open on this game (made before a reload, or by another player). */
  others: string[];
}
const fresh = (game: string | null): State => ({ game, link: null, error: null, revoked: false, others: [] });

export function useShareLink(roomId: string, gameId: string | null) {
  const [stored, setStored] = useState<State>(() => fresh(gameId));
  const [busy, setBusy] = useState(false);
  const state = stored.game === gameId ? stored : fresh(gameId);
  const update = useCallback((patch: Partial<State>) => {
    setStored((s) => ({ ...(s.game === gameId ? s : fresh(gameId)), ...patch }));
  }, [gameId]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    update({ error: null });
    try { await fn(); } catch (e) { update({ error: e instanceof ShareError ? e.code : 'server_error' }); } finally { setBusy(false); }
  }, [update]);

  const refreshOthers = useCallback(async () => {
    try { update({ others: (await activeShareLinks(roomId)).map((l) => l.id) }); } catch { /* shown next time */ }
  }, [roomId, update]);

  const create = useCallback(() => run(async () => {
    if (!gameId) throw new ShareError('no_live_game');
    update({ link: await createShareLink(roomId, gameId), revoked: false });
    await refreshOthers();
  }), [run, roomId, gameId, update, refreshOthers]);

  const revoke = useCallback(() => run(async () => {
    if (!state.link) return;
    await revokeShareLink(state.link.id);
    update({ link: null, revoked: true });
    await refreshOthers();
  }), [run, state.link, update, refreshOthers]);

  const revokeOthers = useCallback(() => run(async () => {
    for (const id of state.others) if (id !== state.link?.id) await revokeShareLink(id);
    await refreshOthers();
  }), [run, state.others, state.link, refreshOthers]);

  return {
    link: state.link, busy, error: state.error, revoked: state.revoked,
    others: state.others.filter((id) => id !== state.link?.id),
    create, revoke, revokeOthers, refreshOthers,
  };
}
export type ShareLinkState = ReturnType<typeof useShareLink>;

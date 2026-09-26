// Saved friends: the list (with who's online), adding by code or from a
// player's card, inviting to a table or tournament, and the invite pop-up.
import { useState } from 'react';
import { levelFromXp } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { api, type Profile } from '../lib/supabase';
import type { Push } from '../lib/push';
import { useSocial, type Friend, type Invite, type InviteTarget, type Social } from '../lib/social';
import { Avatar, useErrorText } from './common';
import { Sheet } from './MainScreen';
import { BellIcon, CheckIcon, EyeIcon, ShareNetworkIcon, UserPlusIcon, UsersThreeIcon, XIcon } from '@phosphor-icons/react';
import './social.css';

/** Online friends first, then by name. */
function sorted(s: Social, list: Friend[]) {
  const rank = (f: Friend) => (s.online.get(f.id) === 'online' ? 0 : s.online.has(f.id) ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function FriendFace({ f, s }: { f: Friend; s: Social }) {
  const where = s.online.get(f.id);
  return (
    <span className={`avatar friend-face ${where ?? 'offline'}`}>
      <Avatar name={f.name} url={f.avatar} />
      {where && <i className="online-dot" aria-hidden />}
    </span>
  );
}

function useWhereText() {
  const { t } = useI18n();
  return (s: Social, id: string) => {
    const where = s.online.get(id);
    return where === 'online' ? t.social.online : where === 'playing' ? t.social.playing : t.social.offline;
  };
}

/** The "Mis amigos" card at the top of the Mesas tab. */
export function FriendsSection({ profile, onQuickInvite, onWatch, push }: {
  profile: Profile; onQuickInvite: (friend: Friend) => void; onWatch?: (friend: Friend) => void; push?: Push;
}) {
  const s = useSocial();
  const { t } = useI18n();
  const errText = useErrorText();
  const whereText = useWhereText();
  const [code, setCode] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  if (!s) return null;

  const friends = sorted(s, s.friends.filter((f) => f.state === 'friend'));
  const incoming = s.friends.filter((f) => f.state === 'incoming');
  const outgoing = s.friends.filter((f) => f.state === 'outgoing');
  const available = friends.filter((f) => s.online.get(f.id) === 'online');
  const playing = friends.filter((f) => s.online.get(f.id) === 'playing');
  const offlineFriends = friends.filter((f) => !s.online.has(f.id));
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setNote(null);
    try { await fn(); if (ok) setNote({ ok: true, text: ok }); } catch (e) { setNote({ ok: false, text: errText(e) }); }
  };
  const add = () => run(async () => {
    const r = await s.request({ code });
    setCode('');
    setNote({ ok: true, text: r.status === 'accepted' ? `${t.social.nowFriends} ${r.name} 🎉` : `${t.social.requestSent} ${r.name}` });
  });
  const share = async () => {
    const text = `${t.social.shareCode} ${profile.friend_code} — ${location.origin}${location.pathname}`;
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    try { await navigator.clipboard.writeText(profile.friend_code ?? ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  };
  const friendRow = (f: Friend) => {
    const where = s.online.get(f.id);
    return (
      <div key={f.id} className={`friend-row friend-item ${where ?? 'offline'}`}>
        <FriendFace f={f} s={s} />
        <span className="friend-main">
          <b>{f.name} <small className="friend-level">{t.looks.lvl} {levelFromXp(f.xp)}</small></b>
          <small className={`friend-where ${where ?? 'offline'}`}>{whereText(s, f.id)}</small>
        </span>
        {editing
          ? <button className="btn ghost small friend-action" onClick={() => confirm(`${t.social.removeConfirm} ${f.name}?`) && run(() => s.remove(f.id))}>{t.social.remove}</button>
          : where === 'playing' && onWatch
            ? <button className="btn ghost small friend-action" onClick={() => onWatch(f)}><EyeIcon size={17} />{t.watch.see}</button>
            : where === 'playing'
              ? null
              : <button className={`btn ${where === 'online' ? 'primary' : 'ghost'} small friend-action`} onClick={() => onQuickInvite(f)}>{t.social.invite}</button>}
      </div>
    );
  };
  const group = (title: string, list: Friend[], kind: string) => list.length > 0 && (
    <div className={`friends-group ${kind}`}>
      <div className="friends-group-head"><h4>{title}</h4><span>{list.length}</span></div>
      <div className="friends-list">{list.map(friendRow)}</div>
    </div>
  );

  return (
    <section className="card friends-card">
      <div className="friends-hero">
        <div className="friends-hero-title">
          <span className="friends-hero-icon"><UsersThreeIcon size={25} weight="fill" /></span>
          <div><h3>{t.social.title}</h3><p><i aria-hidden /> <strong>{available.length}</strong> {t.social.readyNow}</p></div>
        </div>
        <button className="friends-add-trigger" onClick={() => setAddOpen((open) => !open)} aria-expanded={addOpen} aria-controls="friends-add-panel">
          {addOpen ? <XIcon size={18} weight="bold" /> : <UserPlusIcon size={19} weight="bold" />}{addOpen ? t.social.hideAdd : t.social.add}
        </button>
      </div>
      <div className="friends-add-panel" id="friends-add-panel" hidden={!addOpen}>
        <form className="friends-add-form" onSubmit={(e) => { e.preventDefault(); if (code.trim()) add(); }}>
          <label htmlFor="friends-code-input">{t.social.addByCode}</label>
          <div className="join-row">
            <input id="friends-code-input" className="text-input code-input" placeholder={t.social.codePh} value={code} maxLength={8}
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="btn primary" disabled={code.trim().length < 6}>{t.social.add}</button>
          </div>
        </form>
      </div>
      {note && <p className={note.ok ? 'note-ok friends-note' : 'error friends-note'} role="status">{note.text}</p>}

      {(incoming.length > 0 || outgoing.length > 0) && <div className="friends-group friends-requests">
        <div className="friends-group-head"><h4>{t.social.requests}</h4><span>{incoming.length + outgoing.length}</span></div>
        {incoming.map((f) => (
          <div key={f.id} className="friend-row request">
            <FriendFace f={f} s={s} />
            <span className="friend-main"><b>{f.name}</b><small>{t.social.wantsToBeFriends}</small></span>
            <button className="btn primary small friend-action" onClick={() => run(() => s.respond(f.id, true))}><CheckIcon size={16} weight="bold" />{t.social.accept}</button>
            <button className="icon-btn small friend-decline" aria-label={t.social.decline} onClick={() => run(() => s.respond(f.id, false))}><XIcon size={17} /></button>
          </div>
        ))}
        {outgoing.map((f) => (
          <div key={f.id} className="friend-row pending">
            <FriendFace f={f} s={s} />
            <span className="friend-main"><b>{f.name}</b><small>{t.social.pending}</small></span>
            <button className="link-btn" onClick={() => run(() => s.remove(f.id))}>{t.cancel}</button>
          </div>
        ))}
      </div>}

      {friends.length === 0 && incoming.length === 0 && outgoing.length === 0 && <p className="friends-empty">{t.social.empty}</p>}
      {group(t.social.available, available, 'available')}
      {group(t.social.atTable, playing, 'playing')}
      {group(t.social.otherFriends, offlineFriends, 'offline')}
      {friends.length > 0 && (
        <button className="link-btn friends-edit" onClick={() => setEditing((e) => !e)}>{editing ? t.social.done : t.social.edit}</button>
      )}

      <div className="friends-connect">
        <div className="friend-code">
          <span>{t.social.myCode}<b>{profile.friend_code}</b></span>
          <button className="btn ghost small" onClick={share}><ShareNetworkIcon size={17} />{copied ? t.copied : t.social.shareMine}</button>
        </div>
      </div>
      {push && (push.state === 'off' || push.state === 'install') && (
        <div className="push-nudge friends-push">
          <span><BellIcon size={17} />{push.state === 'install' ? t.push.install : t.push.nudge}</span>
          {push.state === 'off' && <button className="btn primary small" disabled={push.busy} onClick={push.toggle}>{t.push.turnOn}</button>}
        </div>
      )}
    </section>
  );
}

/** The notifications switch in Settings, with why it's off when it can't be on. */
export function PushRow({ push }: { push: Push }) {
  const { t } = useI18n();
  const can = push.state === 'on' || push.state === 'off';
  const why = can ? t.push.why : push.state === 'denied' ? t.push.denied : push.state === 'install' ? t.push.install : t.push.unsupported;
  return (
    <label className="setting-row push-row">
      <span>🔔 {t.push.title}<small>{why}</small></span>
      {can && <input type="checkbox" checked={push.state === 'on'} disabled={push.busy} onChange={push.toggle} />}
    </label>
  );
}

/** Invite a friend when you're not at a table yet: start a friendly one (or set one up) and send it. */
export function QuickInviteSheet({ friend, onClose, onRoom, onCustom }: {
  friend: Friend; onClose: () => void; onRoom: (roomId: string) => void; onCustom: (friendId: string) => void;
}) {
  const s = useSocial();
  const { t } = useI18n();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!s) return null;
  const start = async (mode: '1v1' | '2v2' | 'arcade') => {
    setBusy(true);
    setError(null);
    try {
      const { roomId } = await api<{ roomId: string }>('create_custom', {
        settings: mode === 'arcade'
          ? { ruleset: 'arcade', turnSeconds: 25, visibility: 'private' }
          : { mode, stake: 0, target: 100, turnSeconds: 25, visibility: 'private' },
      });
      await s.invite(friend.id, { roomId });
      onRoom(roomId);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Sheet onClose={onClose} className="quick-invite">
      <h2>{t.social.inviteTitle} {friend.name}</h2>
      <p className="fine">{t.social.quickSub}</p>
      <button className="btn primary wide" disabled={busy} onClick={() => start('1v1')}>🤝 {t.modes['1v1'].name} · {t.free}</button>
      <button className="btn primary wide" disabled={busy} onClick={() => start('2v2')}>🤝 {t.modes['2v2'].name} · {t.free}</button>
      <button className="btn primary wide arcade-invite" disabled={busy} onClick={() => start('arcade')}>⚡ {t.arcade.name} · {t.free}</button>
      <button className="btn ghost wide" disabled={busy} onClick={() => onCustom(friend.id)}>⚙️ {t.social.customTable}</button>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}

/** From a table or tournament lobby: pick friends to invite. */
export function InviteFriendsSheet({ target, onClose }: { target: InviteTarget; onClose: () => void }) {
  const s = useSocial();
  const { t } = useI18n();
  const errText = useErrorText();
  const whereText = useWhereText();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!s) return null;
  const friends = sorted(s, s.friends.filter((f) => f.state === 'friend'));
  const sameTarget = (i: Invite) => ('roomId' in target ? i.room_id === target.roomId : i.tournament_id === target.tournamentId);
  const statusOf = (id: string) => s.sent.find((i) => i.to_user === id && sameTarget(i))?.status;
  const send = async (id: string) => {
    setBusy(id);
    setError(null);
    try { await s.invite(id, target); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  return (
    <Sheet onClose={onClose} className="invite-friends">
      <h2>👥 {t.social.inviteFriends}</h2>
      {friends.length === 0 && <p className="fine">{t.social.noFriendsYet}</p>}
      <div className="friend-list">
        {friends.map((f) => {
          const st = statusOf(f.id);
          return (
            <div key={f.id} className={`friend-row ${s.online.has(f.id) ? 'is-online' : ''}`}>
              <FriendFace f={f} s={s} />
              <span className="friend-main"><b>{f.name}</b><small className={`friend-where ${s.online.get(f.id) ?? ''}`}>{whereText(s, f.id)}</small></span>
              {st === 'accepted' ? <span className="invite-state ok">{t.social.coming}</span>
                : st === 'declined' ? <span className="invite-state no">{t.social.cantNow}</span>
                : st === 'sent' ? <span className="invite-state">{t.social.invited} ✓</span>
                : <button className="btn primary small" disabled={busy === f.id} onClick={() => send(f.id)}>{t.social.invite}</button>}
            </div>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <p className="fine">{t.social.inviteHint}</p>
    </Sheet>
  );
}

/** A friend invited me: shows on top of whatever screen I'm on (not at a table). */
export function InviteToast({ onRoom, onTournament }: { onRoom: (roomId: string) => void; onTournament: (id: string) => void }) {
  const s = useSocial();
  const { t } = useI18n();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inv = s?.invites[0];
  if (!s || !inv) return null;
  const d = inv.details;
  const friend = s.friends.find((f) => f.id === inv.from_user);
  const what = d.kind === 'tournament'
    ? `🏆 ${d.name} · ${t.modes[d.mode]?.name ?? d.mode}${d.stake ? ` · 🪙 ${d.stake.toLocaleString()}` : ''}`
    : d.ruleset === 'arcade' ? `⚡ ${t.arcade.name} · ${t.arcade.goal}`
    : `${t.modes[d.mode]?.name ?? d.mode} · ${d.stake ? `🪙 ${d.stake.toLocaleString()}` : t.free}${d.target ? ` · ${t.targetLbl} ${d.target}` : ''}`;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await s.answer(inv, true);
      if (r.tournamentId) return onTournament(r.tournamentId);
      const j = await api<{ roomId: string }>('join_room', { roomId: r.roomId });
      onRoom(j.roomId);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="invite-toast" role="alertdialog" aria-label={t.social.invitesYou}>
      <span className="avatar"><Avatar name={d.from} url={friend?.avatar} /></span>
      <span className="invite-main">
        <b>{d.from} {d.kind === 'tournament' ? t.social.invitesYouTour : t.social.invitesYou}</b>
        <small>{what}</small>
        {error && <small className="error">{error}</small>}
      </span>
      <span className="invite-actions">
        <button className="btn primary small" disabled={busy} onClick={accept}>{t.social.join}</button>
        <button className="btn ghost small" disabled={busy} onClick={() => { s.answer(inv, false).catch(() => {}); }}>{t.social.notNow}</button>
      </span>
    </div>
  );
}

/** On a player's card: add them, or see where you stand. */
export function AddFriendButton({ userId }: { userId: string }) {
  const s = useSocial();
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!s || userId === s.uid) return null;
  const state = s.stateOf(userId);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      {state === 'friend' ? <span className="friend-badge">✓ {t.social.areFriends}</span>
        : state === 'outgoing' ? <span className="friend-badge">⏳ {t.social.requestPending}</span>
        : state === 'incoming' ? <button className="btn primary wide" disabled={busy} onClick={() => run(() => s.respond(userId, true))}>{t.social.acceptRequest}</button>
        : <button className="btn primary wide" disabled={busy} onClick={() => run(() => s.request({ userId }))}>➕ {t.social.addFriend}</button>}
      {error && <p className="error">{error}</p>}
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { Mission, Missions } from '../lib/missions';
import type { Friend, Invite, Social } from '../lib/social';
import type { ChestRow } from '../lib/useChests';
import type { DirectMessage, DirectMessages } from '../lib/directMessages';
import { Avatar, useErrorText } from './common';
import { Sheet } from './MainScreen';
import './inbox.css';

type InboxTab = 'all' | 'social' | 'tournaments' | 'rewards';

export interface InboxSummary {
  incoming: Friend[];
  roomInvites: Invite[];
  tournamentInvites: Invite[];
  missionRewards: Mission[];
  readyChests: ChestRow[];
  dailyReady: boolean;
  unreadMessages: number;
  count: number;
}

/** The inbox only contains things the player can act on now; completed items disappear. */
export function useInboxSummary(social: Social | null, missions: Missions, chests: ChestRow[], dailyReady: boolean, unreadMessages = 0): InboxSummary {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!chests.some((c) => c.unlock_at && Date.parse(c.unlock_at) > Date.now())) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [chests]);

  return useMemo(() => {
    const incoming = social?.friends.filter((f) => f.state === 'incoming') ?? [];
    const roomInvites = social?.invites.filter((i) => !i.tournament_id) ?? [];
    const tournamentInvites = social?.invites.filter((i) => !!i.tournament_id) ?? [];
    const missionRewards = [...missions.missions, ...(missions.bonus ? [missions.bonus] : [])].filter(missions.ready);
    const readyChests = chests.filter((c) => !!c.unlock_at && Date.parse(c.unlock_at) <= now);
    return {
      incoming, roomInvites, tournamentInvites, missionRewards, readyChests, dailyReady, unreadMessages,
      count: incoming.length + roomInvites.length + tournamentInvites.length + missionRewards.length + readyChests.length + (dailyReady ? 1 : 0) + unreadMessages,
    };
  }, [social, missions, chests, dailyReady, unreadMessages, now]);
}

function missionText(m: Mission, t: ReturnType<typeof useI18n>['t']) {
  return t.missions.kinds[m.kind][m.goal === 1 ? 0 : 1].replace('{n}', String(m.goal));
}

export function InboxSheet({ summary, missions, social, messages, initialFriendId, onClose, onAcceptInvite, onOpenDaily, onOpenChests, onChestChanged }: {
  summary: InboxSummary;
  missions: Missions;
  social: Social;
  messages: DirectMessages;
  initialFriendId?: string;
  onClose: () => void;
  onAcceptInvite: (invite: Invite, forfeit?: boolean) => Promise<'in_game' | void>;
  onOpenDaily: () => void;
  onOpenChests: () => void;
  onChestChanged?: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [tab, setTab] = useState<InboxTab>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [warning, setWarning] = useState<Invite | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatFriendId, setChatFriendId] = useState<string | null>(null);
  const friends = social.friends.filter((f) => f.state === 'friend');
  const chatFriend = friends.find((f) => f.id === chatFriendId) ?? null;
  const initialFriendAvailable = !!initialFriendId && friends.some((f) => f.id === initialFriendId);
  useEffect(() => {
    if (initialFriendId && initialFriendAvailable) setChatFriendId(initialFriendId);
    // Opening from a push only chooses the chat once; later renders must not pull the player back into it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFriendId, initialFriendAvailable]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const acceptInvite = (inv: Invite, forfeit = false) => run(inv.id, async () => {
    const result = await onAcceptInvite(inv, forfeit);
    if (result === 'in_game') setWarning(inv);
  });
  const claim = (m: Mission) => run(m.id, async () => {
    const got = await missions.claim(m.id);
    if (got.chest) onChestChanged?.();
    setNote(got.chest ? t.missions.gotChest : `+🪙 ${got.chips?.toLocaleString() ?? 0}${got.xp ? ` · +${got.xp} XP` : ''}`);
  });

  const socialCount = summary.incoming.length + summary.roomInvites.length + summary.unreadMessages;
  const rewardCount = summary.missionRewards.length + summary.readyChests.length + (summary.dailyReady ? 1 : 0);
  const visibleSocial = tab === 'all' || tab === 'social';
  const visibleTours = tab === 'all' || tab === 'tournaments';
  const visibleRewards = tab === 'all' || tab === 'rewards';
  const empty = (visibleSocial && (socialCount > 0 || friends.length > 0)) || (visibleTours && summary.tournamentInvites.length > 0) || (visibleRewards && rewardCount > 0);

  if (chatFriend) {
    return <Sheet onClose={onClose} className="inbox-sheet inbox-chat-sheet">
      <DirectChat friend={chatFriend} messages={messages} online={social.online.has(chatFriend.id)} onBack={() => setChatFriendId(null)} />
    </Sheet>;
  }

  return (
    <Sheet onClose={onClose} className="inbox-sheet">
      <div className="inbox-head">
        <span className="inbox-mark" aria-hidden>✉️</span>
        <div><h2>{t.inbox.title}</h2><p>{t.inbox.subtitle}</p></div>
      </div>
      <div className="inbox-tabs" role="tablist" aria-label={t.inbox.title}>
        {([
          ['all', t.inbox.all, summary.count], ['social', t.inbox.social, socialCount],
          ['tournaments', t.inbox.tournaments, summary.tournamentInvites.length], ['rewards', t.inbox.rewards, rewardCount],
        ] as [InboxTab, string, number][]).map(([id, label, count]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}{count > 0 && <b>{count}</b>}
          </button>
        ))}
      </div>

      <div className="inbox-scroll">
        {visibleSocial && friends.length > 0 && <section className="inbox-group inbox-conversations">
          <h3>💬 {t.inbox.messages}</h3>
          {[...friends].sort((a, b) => {
            const unread = messages.unreadWith(b.id) - messages.unreadWith(a.id);
            if (unread) return unread;
            return (messages.lastWith(b.id)?.id ?? 0) - (messages.lastWith(a.id)?.id ?? 0);
          }).map((friend) => {
            const last = messages.lastWith(friend.id);
            const unread = messages.unreadWith(friend.id);
            return <button type="button" className="inbox-card inbox-conversation" key={friend.id} onClick={() => setChatFriendId(friend.id)}>
              <span className="inbox-avatar"><Avatar name={friend.name} url={friend.avatar} /></span>
              <span className="inbox-copy"><b>{friend.name}{social.online.has(friend.id) && <i className="inbox-online" aria-label={t.inbox.online} />}</b>
                <small>{last ? `${last.sender_id === social.uid ? `${t.inbox.you}: ` : ''}${last.body}` : t.inbox.startChat}</small></span>
              {unread > 0 ? <span className="inbox-unread">{unread > 9 ? '9+' : unread}</span> : <span className="inbox-chat-arrow">›</span>}
            </button>;
          })}
        </section>}

        {visibleSocial && (summary.incoming.length > 0 || summary.roomInvites.length > 0) && <section className="inbox-group">
          <h3>👥 {t.inbox.social}</h3>
          {summary.incoming.map((f) => <article className="inbox-card" key={f.id}>
            <span className="inbox-avatar"><Avatar name={f.name} url={f.avatar} /></span>
            <span className="inbox-copy"><b>{f.name}</b><small>{t.social.wantsToBeFriends}</small></span>
            <span className="inbox-actions">
              <button className="inbox-accept" disabled={!!busy} onClick={() => run(`friend-${f.id}`, () => social.respond(f.id, true))}>{t.social.accept}</button>
              <button className="inbox-decline" aria-label={t.social.decline} disabled={!!busy} onClick={() => run(`friend-${f.id}`, () => social.respond(f.id, false))}>×</button>
            </span>
          </article>)}
          {summary.roomInvites.map((inv) => <InviteRow key={inv.id} invite={inv} busy={busy === inv.id} onAccept={() => acceptInvite(inv)} onDecline={() => run(inv.id, async () => { await social.answer(inv, false); })} />)}
        </section>}

        {visibleTours && summary.tournamentInvites.length > 0 && <section className="inbox-group">
          <h3>🏆 {t.inbox.tournaments}</h3>
          {summary.tournamentInvites.map((inv) => <InviteRow key={inv.id} invite={inv} busy={busy === inv.id} onAccept={() => acceptInvite(inv)} onDecline={() => run(inv.id, async () => { await social.answer(inv, false); })} />)}
        </section>}

        {visibleRewards && rewardCount > 0 && <section className="inbox-group">
          <h3>🎁 {t.inbox.rewards}</h3>
          {summary.dailyReady && <RewardRow icon="🎁" title={t.inbox.dailyTitle} sub={t.inbox.dailySub} action={t.inbox.claim} onClick={onOpenDaily} />}
          {summary.missionRewards.map((m) => <RewardRow key={m.id} icon={m.kind === 'bonus' ? '🎁' : '🎯'} title={m.kind === 'bonus' ? t.missions.bonus : missionText(m, t)}
            sub={m.kind === 'bonus' ? t.missions.bonusReward : `🪙 ${m.chips.toLocaleString()} · +${m.xp} XP`} action={t.inbox.claim} busy={busy === m.id} onClick={() => claim(m)} />)}
          {summary.readyChests.map((c) => <RewardRow key={c.id} icon="🧰" title={t.chest.names[c.kind]} sub={t.inbox.chestReady} action={t.inbox.open} onClick={onOpenChests} />)}
        </section>}

        {!empty && <div className="inbox-empty"><span>✓</span><b>{t.inbox.empty}</b><small>{t.inbox.emptySub}</small></div>}
        {warning && <div className="inbox-warning">
          <b>⚠️ {t.social.inGame}</b><small>{t.social.forfeitWarn.replace('{xp}', '30')}</small>
          <div><button className="btn ghost small" onClick={() => setWarning(null)}>{t.social.keepPlaying}</button><button className="btn danger small" disabled={!!busy} onClick={() => acceptInvite(warning, true)}>{t.social.forfeitGo}</button></div>
        </div>}
        {note && <p className="note-ok">{note}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  );
}

function DirectChat({ friend, messages, online, onBack }: { friend: Friend; messages: DirectMessages; online: boolean; onBack: () => void }) {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const thread = messages.withUser(friend.id);
  const lastId = thread.at(-1)?.id;

  useEffect(() => { void messages.read(friend.id).catch(() => {}); }, [friend.id, lastId, messages]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [lastId]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try { await messages.send(friend.id, body); setText(''); }
    catch (cause) { setError(errText(cause)); }
    finally { setBusy(false); }
  };
  const time = (m: DirectMessage) => new Intl.DateTimeFormat(lang === 'es' ? 'es-DO' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(m.created_at));

  return <div className="direct-chat">
    <header className="direct-chat-head">
      <button type="button" className="inbox-chat-back" onClick={onBack} aria-label={t.back}>‹</button>
      <span className="inbox-avatar"><Avatar name={friend.name} url={friend.avatar} /></span>
      <span><b>{friend.name}</b><small className={online ? 'online' : ''}>{online ? t.inbox.online : t.inbox.offline}</small></span>
    </header>
    <div className="direct-chat-messages" aria-live="polite">
      {thread.length === 0 && <div className="direct-chat-empty"><span>👋</span><b>{t.inbox.sayHello.replace('{name}', friend.name)}</b><small>{t.inbox.privateChat}</small></div>}
      {thread.map((message) => {
        const mine = message.sender_id === messages.uid;
        return <div key={message.id} className={`direct-bubble ${mine ? 'mine' : ''}`}>
          <span>{message.body}</span><small>{time(message)}{mine && ` · ${message.read_at ? '✓✓' : '✓'}`}</small>
        </div>;
      })}
      <div ref={end} />
    </div>
    <form className="direct-chat-form" onSubmit={send}>
      <input maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.inbox.messagePh} aria-label={t.inbox.messagePh} />
      <button type="submit" disabled={busy || !text.trim()} aria-label={t.inbox.send}>➤</button>
    </form>
    {error && <p className="error direct-chat-error">{error}</p>}
  </div>;
}

function InviteRow({ invite, busy, onAccept, onDecline }: { invite: Invite; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const { t } = useI18n();
  const tour = !!invite.tournament_id;
  const arcade = invite.details.ruleset === 'arcade';
  const detail = tour
    ? `${invite.details.name ?? t.inbox.tournament} · ${invite.details.mode}`
    : `${arcade ? '⚡ Arcade' : invite.details.mode}${invite.details.stake ? ` · 🪙 ${invite.details.stake.toLocaleString()}` : ` · ${t.inbox.free}`}`;
  return <article className="inbox-card">
    <span className={`inbox-kind ${tour ? 'tour' : arcade ? 'arcade' : ''}`} aria-hidden>{tour ? '🏆' : arcade ? '⚡' : '🁫'}</span>
    <span className="inbox-copy"><b>{invite.details.from}</b><small>{tour ? t.social.invitesYouTour : t.social.invitesYou}</small><em>{detail}</em></span>
    <span className="inbox-actions"><button className="inbox-accept" disabled={busy} onClick={onAccept}>{t.social.join}</button><button className="inbox-decline" aria-label={t.social.notNow} disabled={busy} onClick={onDecline}>×</button></span>
  </article>;
}

function RewardRow({ icon, title, sub, action, busy, onClick }: { icon: string; title: string; sub: string; action: string; busy?: boolean; onClick: () => void }) {
  return <article className="inbox-card reward">
    <span className="inbox-kind reward" aria-hidden>{icon}</span>
    <span className="inbox-copy"><b>{title}</b><small>{sub}</small></span>
    <button className="inbox-accept" disabled={busy} onClick={onClick}>{action}</button>
  </article>;
}

import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CaretDownIcon, CaretUpIcon, ChatCircleDotsIcon, FireIcon, HandsClappingIcon,
  PaperPlaneTiltIcon, ShareNetworkIcon, SmileyIcon, UsersThreeIcon,
} from '@phosphor-icons/react';
import { useI18n } from '../i18n';
import { usePlayerStats, type PlayerStats } from '../lib/useRoom';
import type { SpectatorMessage, Watcher } from '../lib/watch';
import { Avatar } from './common';
import { ProfileCard } from './ProfileCard';
import './spectator-chat.css';

const authorIds = (messages: SpectatorMessage[]) => [...new Set(messages.map((m) => m.user_id).filter((id) => id && !id.startsWith('link-')))];

function placeholder(m: SpectatorMessage): PlayerStats {
  return {
    id: m.user_id, display_name: m.name, avatar_url: null, xp: 0, games: 0, wins: 0,
    capicuas: 0, pollonas: 0, biggest_pot: 0, tournaments_won: 0,
  };
}

function relativeTime(iso: string, now: string, minutes: string) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return now;
  const n = Math.max(0, Math.floor((Date.now() - at) / 60_000));
  return n < 1 ? now : minutes.replace('{n}', String(n));
}

export function SpectatorMessageRow({ message, mine, profile, onAuthor, compact = false }: {
  message: SpectatorMessage;
  mine: boolean;
  profile?: PlayerStats;
  onAuthor?: (id: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const clickable = !!onAuthor && !!message.user_id && !message.user_id.startsWith('link-');
  const author = (
    <>
      <span className="spectator-message-avatar"><Avatar name={message.name} url={profile?.avatar_url ?? null} /></span>
      <span className="spectator-message-copy">
        <span className="spectator-message-meta">
          <b>{mine ? t.spec.youLabel : message.name}</b>
          {!compact && <time dateTime={message.created_at} title={message.created_at}>{relativeTime(message.created_at, t.spec.now, t.spec.minutesAgo)}</time>}
        </span>
        <span className="spectator-message-body">{message.body}</span>
      </span>
    </>
  );
  return clickable ? (
    <button type="button" className={`spectator-message ${mine ? 'mine' : ''} ${compact ? 'compact' : ''}`} onClick={() => onAuthor(message.user_id)}
      aria-label={t.spec.openProfile.replace('{name}', message.name)}>{author}</button>
  ) : <div className={`spectator-message ${mine ? 'mine' : ''} ${compact ? 'compact' : ''}`}>{author}</div>;
}

function ChatProfile({ id, messages, stats, onClose }: {
  id: string | null;
  messages: SpectatorMessage[];
  stats: Record<string, PlayerStats>;
  onClose: () => void;
}) {
  if (!id) return null;
  const message = messages.find((m) => m.user_id === id);
  if (!message) return null;
  return <ProfileCard stats={stats[id] ?? placeholder(message)} loading={!stats[id]} onClose={onClose} />;
}

export function SpectatorChatDock({ watchers, count, uid, messages, onSend, readOnlyNote, collapsed, unread = 0,
  onCollapsedChange, onOpenWatchers, onShare }: {
  watchers: Watcher[];
  count?: number;
  uid: string;
  messages: SpectatorMessage[];
  onSend?: (text: string) => Promise<void>;
  readOnlyNote?: string;
  collapsed: boolean;
  unread?: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenWatchers?: () => void;
  onShare?: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const ids = useMemo(() => authorIds(messages), [messages]);
  const stats = usePlayerStats(ids);
  const latest = messages.slice(-2);
  const send = async (body: string) => {
    if (!onSend || !body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { await onSend(body.trim()); setText(''); }
    catch { setError(t.spec.sendFailed); }
    finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void send(text); };
  // The latest few people who wrote, each once.
  const faces = [...new Map([...messages].reverse().map((m) => [m.user_id, m])).values()].slice(0, 3);

  if (collapsed) {
    const last = messages.at(-1);
    return (
      <section className="spectator-chat-dock collapsed" aria-label={t.spec.tableChat}>
        <button type="button" className="spectator-chat-collapsed" onClick={() => onCollapsedChange(false)} aria-expanded="false">
          <ChatCircleDotsIcon size={22} weight="fill" aria-hidden />
          <span><b>{t.spec.tableChat}</b>{last && <small>{last.name}: {last.body}</small>}</span>
          {unread > 0 && <i className="spectator-unread" aria-label={t.spec.unread.replace('{n}', String(unread))}>{unread}</i>}
          <CaretUpIcon size={20} aria-hidden />
        </button>
      </section>
    );
  }

  return (
    <section className="spectator-chat-dock" aria-label={t.spec.tableChat}>
      <header className="spectator-chat-head">
        <button type="button" className="spectator-chat-title" onClick={onOpenWatchers} disabled={!onOpenWatchers}>
          <ChatCircleDotsIcon size={23} weight="fill" aria-hidden /><b>{t.spec.tableChat}</b>
        </button>
        {onShare && (
          <button type="button" className="spectator-chat-share" onClick={onShare} aria-label={t.share.button} title={t.share.button}>
            <ShareNetworkIcon size={18} weight="bold" aria-hidden />
          </button>
        )}
        <button type="button" className="spectator-chat-collapse" onClick={() => onCollapsedChange(true)} aria-label={t.spec.collapseChat} aria-expanded="true">
          <CaretDownIcon size={20} aria-hidden />
        </button>
      </header>
      <button type="button" className="spectator-presence" onClick={onOpenWatchers} disabled={!onOpenWatchers}>
        <span className="spectator-face-stack" aria-hidden>
          {faces.map((m) => <span key={m.user_id}><Avatar name={m.name} url={stats[m.user_id]?.avatar_url ?? null} /></span>)}
        </span>
        <UsersThreeIcon size={18} aria-hidden />
        <span>{t.spec.watchingCount.replace('{n}', String(count ?? watchers.length))}</span>
      </button>
      <div className="spectator-chat-messages" aria-live="polite">
        {latest.length === 0 ? <p className="spectator-chat-empty">{t.spec.noMessages}</p> : latest.map((m) => (
          <SpectatorMessageRow key={m.id} message={m} mine={m.user_id === uid} profile={stats[m.user_id]} onAuthor={setProfileId} />
        ))}
      </div>
      {onSend ? (
        <>
          <div className="spectator-reactions" aria-label={t.spec.quickReactions}>
            <button type="button" disabled={busy} onClick={() => void send(t.spec.reactionGood)}><FireIcon size={18} weight="fill" />{t.spec.good}</button>
            <button type="button" disabled={busy} onClick={() => void send(t.spec.reactionBravo)}><HandsClappingIcon size={18} weight="fill" />{t.spec.bravo}</button>
            <button type="button" disabled={busy} onClick={() => void send(t.spec.reactionWow)}><SmileyIcon size={18} weight="fill" />{t.spec.wow}</button>
          </div>
          <form className="spectator-chat-form" onSubmit={submit}>
            <input maxLength={80} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.spec.chatDockPh} aria-label={t.spec.chatDockPh} />
            <button type="submit" disabled={busy || !text.trim()} aria-label={t.spec.send}><PaperPlaneTiltIcon size={21} weight="fill" /></button>
          </form>
        </>
      ) : readOnlyNote ? <p className="spectator-readonly">{readOnlyNote}</p> : null}
      {error && <p className="spectator-chat-error" role="alert">{error}</p>}
      <ChatProfile id={profileId} messages={messages} stats={stats} onClose={() => setProfileId(null)} />
    </section>
  );
}

export function SpectatorChatPreview({ count, uid, messages, collapsed, unread = 0, onCollapsedChange, onOpen, onShare }: {
  count: number;
  uid: string;
  messages: SpectatorMessage[];
  collapsed: boolean;
  unread?: number;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpen: () => void;
  onShare?: () => void;
}) {
  const { t } = useI18n();
  const [profileId, setProfileId] = useState<string | null>(null);
  const ids = useMemo(() => authorIds(messages), [messages]);
  const stats = usePlayerStats(ids);
  const latest = messages.slice(-2);
  const root = useRef<HTMLElement>(null);
  return (
    <section ref={root} className={`spectator-chat-preview ${collapsed ? 'collapsed' : ''}`} aria-label={t.spec.audienceChat}>
      <header>
        <button type="button" className="spectator-preview-title" onClick={onOpen}>
          <UsersThreeIcon size={20} weight="fill" aria-hidden /><b>{t.spec.audience}</b><span>· {count}</span>
          {collapsed && unread > 0 && <i className="spectator-unread" aria-label={t.spec.unread.replace('{n}', String(unread))}>{unread}</i>}
        </button>
        <button type="button" className="spectator-preview-open" onClick={onOpen}>{t.spec.viewChat}</button>
        {onShare && (
          <button type="button" className="spectator-chat-share" onClick={onShare} aria-label={t.share.button} title={t.share.button}>
            <ShareNetworkIcon size={18} weight="bold" aria-hidden />
          </button>
        )}
        <button type="button" className="spectator-chat-collapse" onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? t.spec.expandChat : t.spec.collapseChat} aria-expanded={!collapsed}>
          {collapsed ? <CaretUpIcon size={18} /> : <CaretDownIcon size={18} />}
        </button>
      </header>
      {!collapsed && <div className="spectator-preview-messages">
        {latest.length === 0 ? <p className="spectator-chat-empty">{t.spec.noMessages}</p> : latest.map((m) => (
          <SpectatorMessageRow key={m.id} message={m} mine={m.user_id === uid} profile={stats[m.user_id]} onAuthor={setProfileId} compact />
        ))}
      </div>}
      <ChatProfile id={profileId} messages={messages} stats={stats} onClose={() => setProfileId(null)} />
    </section>
  );
}

// Admin panel (emails listed in the `admins` table). Everything goes through the `game`
// edge function's admin_* actions, which re-check the admin list each call.
import { useCallback, useEffect, useState } from 'react';
import { levelFromXp } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { api, supabase } from '../lib/supabase';
import { Avatar, useErrorText } from './common';

type Section = 'stats' | 'users' | 'fair' | 'tables' | 'ledger' | 'purchases';

interface Stats {
  players: number; guests: number; new_today: number; games_today: number; live_tables: number; in_queue: number;
  chips_total: number; house_side_bets: number; revenue_cents: number; revenue_today_cents: number; chests_today: number;
}
interface UserRow {
  id: string; display_name: string; chips: number; xp: number; games: number; wins: number;
  created_at: string; banned_until: string | null; ban_reason: string | null; email: string | null; guest: boolean;
  avatar_url?: string | null;
}
interface TableRow { id: string; code: string; kind: string; mode: string; stake: number; phase: string; created_at: string; seats: { seat: number; name: string; bot: boolean; away: boolean }[] }
interface LedgerRow { delta: number; reason: string; note: string | null; created_at: string; display_name?: string }
interface PurchaseRow { pack: string; chips: number; amount_cents: number; status: string; created_at: string; display_name?: string; email?: string }
interface FairReport {
  id: string; name: string; banned_until: string | null; reports: number; reporters: number; reporters_7d: number;
  reasons: string[]; last_note: string | null; last_at: string;
}
interface FairPair {
  u1: string; u2: string; name1: string; name2: string; games: number; public_games: number; partners: number; partner_wins: number;
  wins1: number; wins2: number; staked: number; flags: string[];
}
interface FairLeaver { id: string; name: string; left_app: number; screenshots: number; seconds_away: number; games: number }
interface FairUser {
  fair: { reports: number; open_reports: number; left_7d: number; screenshots_7d: number; games_7d: number };
  reports: { reason: string; note: string | null; status: string; created_at: string; reporter: string }[];
  sameNetwork: { id: string; display_name: string }[];
}

const money = (cents: number) => `US$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

export function AdminScreen({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>('stats');
  const [openUser, setOpenUser] = useState<string | null>(null);
  const tabs: [Section, string][] = [
    ['stats', t.admin.stats], ['users', t.admin.users], ['fair', t.admin.fair], ['tables', t.admin.tables], ['ledger', t.admin.ledger], ['purchases', t.admin.purchases],
  ];
  return (
    <div className="admin">
      <header className="admin-head">
        <button className="link-btn back" onClick={onExit}>← {t.back}</button>
        <h1>🛡️ {t.admin.title}</h1>
      </header>
      <nav className="admin-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={section === id ? 'on' : ''} onClick={() => { setSection(id); setOpenUser(null); }}>{label}</button>
        ))}
      </nav>
      <main className="admin-body">
        {openUser ? <UserDetail key={openUser} id={openUser} onBack={() => setOpenUser(null)} onOpen={setOpenUser} />
          : section === 'stats' ? <StatsView />
          : section === 'users' ? <UsersView onOpen={setOpenUser} />
          : section === 'fair' ? <FairPlayView onOpen={setOpenUser} />
          : section === 'tables' ? <TablesView />
          : section === 'ledger' ? <LedgerView />
          : <PurchasesView />}
      </main>
    </div>
  );
}

function useAdmin<T>(action: string, payload: Record<string, unknown> = {}) {
  const errText = useErrorText();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(payload);
  const load = useCallback(() => {
    api<T>(action, JSON.parse(key)).then(setData).catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, key]);
  useEffect(load, [load]);
  return { data, error, reload: load };
}

function StatsView() {
  const { t } = useI18n();
  const { data: s, error, reload } = useAdmin<Stats>('admin_stats');
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="fine">{t.loading}</p>;
  const cards: [string, string][] = [
    [t.admin.k.players, `${s.players.toLocaleString()} (${s.guests} ${t.admin.k.guests})`],
    [t.admin.k.newToday, s.new_today.toLocaleString()],
    [t.admin.k.gamesToday, s.games_today.toLocaleString()],
    [t.admin.k.live, `${s.live_tables} · ${s.in_queue} ${t.admin.k.queue}`],
    [t.admin.k.revenueToday, money(s.revenue_today_cents)],
    [t.admin.k.revenue, money(s.revenue_cents)],
    [t.admin.k.chips, s.chips_total.toLocaleString()],
    [t.admin.k.house, s.house_side_bets.toLocaleString()],
    [t.admin.k.chests, s.chests_today.toLocaleString()],
  ];
  return (
    <>
      <div className="kpi-grid">
        {cards.map(([label, value]) => <div key={label} className="kpi"><small>{label}</small><b>{value}</b></div>)}
      </div>
      <button className="btn ghost" onClick={reload}>↻ {t.refresh}</button>
    </>
  );
}

function UsersView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error } = useAdmin<UserRow[]>('admin_users', { q: search });
  // Photos come straight from profiles (public to signed-in players), so moderation can see them at a glance.
  const [photos, setPhotos] = useState<Record<string, string | null>>({});
  const ids = data?.map((u) => u.id).join(',') ?? '';
  useEffect(() => {
    if (!ids) return;
    supabase.from('profiles').select('id, avatar_url').in('id', ids.split(',')).not('avatar_url', 'is', null)
      .then(({ data: rows }) => setPhotos(Object.fromEntries((rows ?? []).map((p) => [p.id, p.avatar_url]))));
  }, [ids]);
  return (
    <>
      <form className="join-row" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <input className="text-input" placeholder={t.admin.searchPh} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary">{t.admin.search}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <table className="admin-table">
        <thead><tr><th>{t.admin.col.player}</th><th>{t.admin.col.level}</th><th>🪙</th><th>{t.admin.col.games}</th></tr></thead>
        <tbody>
          {data?.map((u) => (
            <tr key={u.id} onClick={() => onOpen(u.id)} className={u.banned_until ? 'banned' : ''}>
              <td className="admin-player">
                <span className="avatar"><Avatar name={u.display_name} url={photos[u.id]} /></span>
                <b>{u.display_name}</b>{u.guest && <em> · {t.admin.guest}</em>}{u.banned_until && <em> · ⛔</em>}
                <small>{u.email ?? '—'}</small>
              </td>
              <td>{levelFromXp(u.xp)}</td>
              <td>{Number(u.chips).toLocaleString()}</td>
              <td>{u.games} / {u.wins}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Cheat alerts: reports by player, pairs that play together suspiciously, who leaves the app. */
function FairPlayView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { data, error, reload } = useAdmin<{ reports: FairReport[]; suspects: FairPair[]; leavers: FairLeaver[] }>('admin_fairplay');
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="fine">{t.loading}</p>;
  const who = (id: string, name: string) => <button className="link-btn fair-name" onClick={() => onOpen(id)}>{name}</button>;
  return (
    <div className="fair-admin">
      <button className="btn ghost" onClick={reload}>↻ {t.refresh}</button>

      <h3 className="section-title">⚑ {t.admin.reports}</h3>
      {data.reports.length === 0 && <p className="fine">{t.admin.noReports}</p>}
      {data.reports.map((r) => (
        <div key={r.id} className={`admin-card fair-row ${r.reporters_7d >= 3 ? 'hot' : ''}`}>
          <div>
            {who(r.id, r.name)}{r.banned_until && new Date(r.banned_until).getTime() > Date.now() && ' ⛔'}
            {' '}· <b>{r.reports}</b> ({r.reporters} {t.admin.reporters})
            <small>{r.reasons.map((x) => t.fair.reasons[x] ?? x).join(', ')}{r.last_note && ` — “${r.last_note}”`}</small>
            <small>{when(r.last_at)}</small>
          </div>
        </div>
      ))}

      <h3 className="section-title">🕵️ {t.admin.suspects}</h3>
      {data.suspects.length === 0 && <p className="fine">{t.admin.noSuspects}</p>}
      {data.suspects.map((p) => (
        <div key={`${p.u1}${p.u2}`} className="admin-card fair-row">
          <div>
            {who(p.u1, p.name1)} + {who(p.u2, p.name2)}
            <span className="fair-flags">{p.flags.map((f) => <em key={f} className={`fair-flag ${f}`}>{t.admin.flags[f] ?? f}</em>)}</span>
            <small>
              {p.games} {t.admin.together}
              {p.partners > 0 && ` · ${p.partners} ${t.admin.asPartners} (${p.partner_wins} ${t.admin.partnerWins})`}
              {p.wins1 + p.wins2 > 0 && ` · ${p.name1} ${p.wins1}–${p.wins2} ${p.name2}`}
              {p.staked > 0 && ` · 🪙 ${p.staked.toLocaleString()} ${t.admin.staked}`}
            </small>
          </div>
        </div>
      ))}

      <h3 className="section-title">📵 {t.admin.leavers}</h3>
      {data.leavers.length === 0 && <p className="fine">{t.admin.noLeavers}</p>}
      {data.leavers.map((l) => (
        <div key={l.id} className="admin-card fair-row">
          <div>
            {who(l.id, l.name)}
            <small>
              {l.left_app} {t.admin.leftApp} · {l.screenshots} {t.admin.shots} · {Math.round(l.seconds_away / 60)} min {t.admin.away} · {l.games} {t.admin.gamesShort}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function UserDetail({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const { data, error, reload } = useAdmin<{ user: UserRow; ledger: LedgerRow[]; purchases: PurchaseRow[] } & Partial<FairUser>>('admin_user', { id });
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMsg(null);
    try { await fn(); setMsg(done); reload(); } catch (e) { setMsg(errText(e)); }
  };
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="fine">{t.loading}</p>;
  const u = data.user;
  const banned = u.banned_until && new Date(u.banned_until).getTime() > Date.now();
  return (
    <div className="admin-user">
      <button className="link-btn back" onClick={onBack}>← {t.admin.users}</button>
      <div className="admin-photo">
        <span className="avatar big"><Avatar name={u.display_name} url={u.avatar_url} /></span>
        {u.avatar_url && (
          <button className="btn ghost" onClick={() => confirm(t.admin.removePhotoConfirm) && act(async () => {
            const { error: e } = await supabase.rpc('admin_clear_avatar', { p_user: u.id });
            if (e) throw e;
          }, t.admin.done)}>🚫 {t.admin.removePhoto}</button>
        )}
      </div>
      <h2>{u.display_name} {u.guest && <em className="fine">({t.admin.guest})</em>}</h2>
      <p className="fine left">{u.email ?? '—'} · {t.admin.col.level} {levelFromXp(u.xp)} · {u.games} {t.admin.col.games} · {when(u.created_at)}</p>
      <p className="big-balance">🪙 {Number(u.chips).toLocaleString()}</p>
      {banned && <p className="error">⛔ {t.admin.bannedUntil} {u.banned_until === 'infinity' ? '∞' : when(u.banned_until!)} — {u.ban_reason}</p>}

      <section className="card">
        <h3>{t.admin.adjust}</h3>
        <div className="join-row">
          <input className="text-input" type="number" placeholder="+500 / -200" value={delta} onChange={(e) => setDelta(e.target.value)} />
        </div>
        <input className="text-input" placeholder={t.admin.notePh} value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary" disabled={!Number(delta) || !note.trim()}
          onClick={() => act(() => api('admin_adjust', { userId: u.id, delta: Math.trunc(Number(delta)), note }), t.admin.done)}>
          {t.admin.apply}
        </button>
      </section>

      <section className="card">
        <h3>{t.admin.ban}</h3>
        <div className="seg">
          <button onClick={() => act(() => api('admin_ban', { userId: u.id, hours: 24, reason: note || 'admin' }), t.admin.done)}>24h</button>
          <button onClick={() => act(() => api('admin_ban', { userId: u.id, hours: 168, reason: note || 'admin' }), t.admin.done)}>7d</button>
          <button onClick={() => confirm(t.admin.permConfirm) && act(() => api('admin_ban', { userId: u.id, hours: -1, reason: note || 'admin' }), t.admin.done)}>∞</button>
          <button className="on" disabled={!banned} onClick={() => act(() => api('admin_ban', { userId: u.id, hours: 0 }), t.admin.done)}>{t.admin.unban}</button>
        </div>
      </section>
      {msg && <p className="note-ok">{msg}</p>}

      {data.fair && (
        <section className="card fair-user">
          <h3>🛡️ {t.admin.fairBlock}</h3>
          <p className="fine left">
            ⚑ {data.fair.reports} ({data.fair.open_reports} {t.admin.openReports}) · 📵 {data.fair.left_7d} {t.admin.leftApp}
            {' '}· 📸 {data.fair.screenshots_7d} {t.admin.shots} · {data.fair.games_7d} {t.admin.gamesShort}
          </p>
          {!!data.sameNetwork?.length && (
            <p className="fine left">
              🏠 {t.admin.sameNetwork}:{' '}
              {data.sameNetwork.map((o, i) => (
                <span key={o.id}>{i > 0 && ', '}<button className="link-btn fair-name" onClick={() => onOpen(o.id)}>{o.display_name}</button></span>
              ))}
            </p>
          )}
          {data.reports?.map((r, i) => (
            <p key={i} className={`fine left fair-report ${r.status}`}>
              {when(r.created_at)} · <b>{r.reporter}</b>: {t.fair.reasons[r.reason] ?? r.reason}{r.note && ` — “${r.note}”`}
            </p>
          ))}
          {data.fair.open_reports > 0 && (
            <div className="seg">
              <button onClick={() => act(() => api('admin_report_resolve', { userId: u.id, status: 'dismissed' }), t.admin.done)}>{t.admin.dismiss}</button>
              <button onClick={() => act(() => api('admin_report_resolve', { userId: u.id, status: 'actioned' }), t.admin.done)}>{t.admin.actioned}</button>
            </div>
          )}
        </section>
      )}

      <h3 className="section-title">{t.admin.ledger}</h3>
      <LedgerTable rows={data.ledger} />
      {data.purchases.length > 0 && (
        <>
          <h3 className="section-title">{t.admin.purchases}</h3>
          <PurchaseTable rows={data.purchases} />
        </>
      )}
    </div>
  );
}

function TablesView() {
  const { t } = useI18n();
  const errText = useErrorText();
  const { data, error, reload } = useAdmin<TableRow[]>('admin_tables');
  const close = async (r: TableRow) => {
    if (!confirm(`${t.admin.closeConfirm} ${r.code}?`)) return;
    try { await api('admin_close_table', { roomId: r.id }); reload(); } catch (e) { alert(errText(e)); }
  };
  if (error) return <p className="error">{error}</p>;
  return (
    <>
      <button className="btn ghost" onClick={reload}>↻ {t.refresh}</button>
      {data?.length === 0 && <p className="fine">{t.admin.noTables}</p>}
      {data?.map((r) => (
        <div key={r.id} className="admin-card">
          <div>
            <b>{r.code}</b> · {r.kind} · {r.mode} · {r.stake ? `🪙 ${r.stake}` : t.free} · <em>{r.phase}</em>
            <small>{r.seats.map((s) => `${s.name}${s.bot ? ' 🤖' : ''}${s.away ? ' 💤' : ''}`).join(', ')}</small>
          </div>
          <button className="btn ghost danger" onClick={() => close(r)}>{t.admin.close}</button>
        </div>
      ))}
    </>
  );
}

function LedgerView() {
  const { data, error } = useAdmin<LedgerRow[]>('admin_ledger');
  if (error) return <p className="error">{error}</p>;
  return <LedgerTable rows={data ?? []} withName />;
}

function PurchasesView() {
  const { data, error } = useAdmin<PurchaseRow[]>('admin_purchases');
  if (error) return <p className="error">{error}</p>;
  return <PurchaseTable rows={data ?? []} withName />;
}

function LedgerTable({ rows, withName }: { rows: LedgerRow[]; withName?: boolean }) {
  return (
    <table className="admin-table compact">
      <tbody>
        {rows.map((l, i) => (
          <tr key={i}>
            <td><small>{when(l.created_at)}</small></td>
            {withName && <td>{l.display_name}</td>}
            <td>{l.reason}{l.note && <small>{l.note}</small>}</td>
            <td className={Number(l.delta) >= 0 ? 'up' : 'down'}>{Number(l.delta) >= 0 ? '+' : ''}{Number(l.delta).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PurchaseTable({ rows, withName }: { rows: PurchaseRow[]; withName?: boolean }) {
  return (
    <table className="admin-table compact">
      <tbody>
        {rows.map((p, i) => (
          <tr key={i}>
            <td><small>{when(p.created_at)}</small></td>
            {withName && <td>{p.display_name}<small>{p.email}</small></td>}
            <td>{Number(p.chips).toLocaleString()} 🪙</td>
            <td>{money(p.amount_cents)}</td>
            <td><em>{p.status}</em></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

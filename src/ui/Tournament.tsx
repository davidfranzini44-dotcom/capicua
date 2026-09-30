// Private knockout tournaments: create one, the invite a friend opens, the
// sign-up lobby and the live bracket. Every change goes through the `game`
// function; the bracket itself updates over Realtime.
import { useEffect, useState, type CSSProperties } from 'react';
import { checkInOpen, stage, TOURNAMENT, TOURNAMENT_SIZES, playersPerEntry, type TournamentSettings } from '../../supabase/functions/_shared/tournament.ts';
import { useI18n, type Strings } from '../i18n';
import { api, type Profile } from '../lib/supabase';
import {
  useMyTournaments, useTournament, type EntryRow, type MatchRow, type TournamentPeek, type TournamentRow,
} from '../lib/useTournament';
import { useSocial } from '../lib/social';
import { ChipBalance, useErrorText } from './common';
import { InviteFriendsSheet } from './Friends';
import { markTrophySeen, trophySeen } from '../lib/tournamentPlace';
import { ChampionCelebration, TrophyCup } from './Trophies';

const inviteUrl = (code: string) => `${location.origin}${location.pathname}?torneo=${code}`;

/** 70% / 30% of the pot, as the server pays it. */
function purse(pot: number) {
  const first = Math.floor(pot * TOURNAMENT.prizeShares[0]);
  return { first, second: pot - first };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const locale = (lang: string) => (lang === 'es' ? 'es-DO' : 'en-US');
const timeOf = (ms: number, lang: string) => new Date(ms).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' });

/** "hoy 9:30 p. m." / "mañana 8:00 p. m." / "vie., 3 oct. 9:00 p. m." */
function whenText(ms: number, lang: string, t: Strings) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const day = d.toDateString() === today.toDateString() ? t.tour.today
    : d.toDateString() === tomorrow.toDateString() ? t.tour.tomorrow
    : d.toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${timeOf(ms, lang)}`;
}

/** "23 min" / "1 h 20 min" / "2 d" */
function untilText(ms: number) {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** Start-time choices: minutes from now, or a time the host types. */
const START_PRESETS = [5, 15, 30, 60, 120] as const;
const presetLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);
/** For <input type="datetime-local">: local time, no seconds. */
const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

// ---------- create ----------

export function TournamentForm({ profile, guest, onBack, onCreated }: {
  profile: Profile; guest: boolean; onBack: () => void; onCreated: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const [s, setS] = useState<TournamentSettings>({ name: '', mode: '1v1', size: 8, buyIn: guest ? 0 : 500, target: 100, turnSeconds: 25 });
  // When it starts: minutes from now, or 'custom' with the time typed in.
  const [startIn, setStartIn] = useState<number | 'custom'>(30);
  const [custom, setCustom] = useState(() => localInput(Date.now() + 60 * 60_000));
  const now = useNow(true);
  const startsAt = startIn === 'custom' ? new Date(custom).getTime() : now + startIn * 60_000;
  const startOk = Number.isFinite(startsAt) && startsAt >= now + TOURNAMENT.minLeadMs - 30_000 && startsAt <= now + TOURNAMENT.maxLeadMs;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TournamentSettings>(k: K, v: TournamentSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const unit = s.mode === '2v2' ? t.tour.pairs : t.tour.players;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const at = startIn === 'custom' ? new Date(custom).getTime() : Date.now() + startIn * 60_000;
      onCreated((await api<{ id: string }>('tournament_create', { settings: { ...s, startsAt: at } })).id);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="hub-top">
        <button className="link-btn back" onClick={onBack}>← {t.back}</button>
        <ChipBalance profile={profile} />
      </div>
      <h2 className="screen-title">🏆 {t.tour.newTitle}</h2>
      <section className="card form">
        <label className="label">{t.tour.nameLbl}</label>
        <input className="text-input" maxLength={30} placeholder={t.tour.namePh} value={s.name} onChange={(e) => set('name', e.target.value)} />
        <label className="label">{t.modeLbl}</label>
        <Seg value={s.mode} options={[['1v1', t.modes['1v1'].name], ['2v2', t.modes['2v2'].name]]} onChange={(v) => set('mode', v)} />
        <label className="label">{t.tour.sizeLbl}</label>
        <Seg value={s.size} options={TOURNAMENT_SIZES.map((n) => [n, `${n} ${unit}`] as [TournamentSettings['size'], string])} onChange={(v) => set('size', v)} />
        <label className="label">{t.tour.buyInLbl}</label>
        {guest ? (
          <p className="fine left people-only">🔒 {t.guestFreeOnly}</p>
        ) : (
          <>
            <div className="join-row">
              <input className="text-input" type="number" min={0} step={50} value={s.buyIn}
                onChange={(e) => set('buyIn', Math.min(TOURNAMENT.maxBuyIn, Math.max(0, Math.floor(Number(e.target.value) || 0))))} />
            </div>
            <Seg value={s.buyIn} options={[[0, t.free], [250, '250'], [500, '500'], [1000, '1,000'], [2500, '2,500']]} onChange={(v) => set('buyIn', v)} />
          </>
        )}
        <label className="label">{t.targetLbl}</label>
        <Seg value={s.target} options={[[100, '100'], [150, '150'], [200, '200']]} onChange={(v) => set('target', v)} />
        <label className="label">{t.turnTimerLbl}</label>
        <Seg value={s.turnSeconds} options={[[15, '15s'], [25, '25s'], [40, '40s']]} onChange={(v) => set('turnSeconds', v)} />
        <label className="label">{t.tour.startLbl}</label>
        <Seg<number | 'custom'> value={startIn}
          options={[...START_PRESETS.map((m) => [m, presetLabel(m)] as [number, string]), ['custom', t.tour.otherTime]]}
          onChange={setStartIn} />
        {startIn === 'custom' && (
          <input className="text-input" type="datetime-local" value={custom} min={localInput(now + TOURNAMENT.minLeadMs)}
            max={localInput(now + TOURNAMENT.maxLeadMs)} onChange={(e) => setCustom(e.target.value)} />
        )}
        <p className={`fine left tour-when ${startOk ? '' : 'error'}`}>
          🕘 {startOk ? t.tour.startsAt.replace('{when}', whenText(startsAt, lang, t)) : t.errors.bad_settings}
        </p>
        <p className="fine left">{t.tour.checkInRule}</p>
        <p className="fine left">{t.tour.minPeople}</p>
        {s.buyIn > 0 && <p className="fine left">🪙 {t.tour.potRule}</p>}
      </section>
      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" disabled={busy || s.name.trim().length < 3 || s.buyIn > profile.chips || !startOk} onClick={create}>
        {t.tour.create}{s.buyIn > 0 ? ` · 🪙 ${s.buyIn.toLocaleString()}` : ''}
      </button>
    </div>
  );
}

// ---------- the tournament screen ----------

/** A tournament by id, or an invite by code. Non-members see the invite preview until they sign up. */
export function TournamentScreen({ id, code, uid, profile, onBack, onRoom, onWatch }: {
  id?: string; code?: string; uid: string; profile: Profile; onBack: () => void; onRoom: (roomId: string) => void;
  /** Watch one of this tournament's matches as a spectator. */
  onWatch?: (roomId: string, tournamentId: string) => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [tid, setTid] = useState<string | null>(id ?? null);
  const data = useTournament(tid);
  const [peek, setPeek] = useState<TournamentPeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needPeek = !tid || data.missing;
  useEffect(() => {
    if (!needPeek) return;
    api<TournamentPeek>('tournament_peek', tid ? { id: tid } : { code })
      .then((p) => {
        setPeek(p);
        setTid(p.id);
      })
      .catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needPeek, tid, code]);

  // Keep the bracket moving (the server has its own clock too): nudge it at the start time, when a
  // Ready clock runs out, and every 30 s while it's played.
  const phase = data.t?.phase;
  const startsAt = data.t?.phase === 'lobby' && data.t.starts_at ? new Date(data.t.starts_at).getTime() : null;
  useEffect(() => {
    if (startsAt === null || !tid) return;
    const id = setTimeout(() => api('tournament_tick', { id: tid }).catch(() => {}), Math.max(0, startsAt - Date.now() + 2000));
    return () => clearTimeout(id);
  }, [startsAt, tid]);
  const deadlines = data.matches.filter((m) => m.status === 'ready' && m.ready_by).map((m) => new Date(m.ready_by!).getTime());
  const nextDeadline = deadlines.length ? Math.min(...deadlines) : null;
  useEffect(() => {
    if (phase !== 'playing' || !tid) return;
    const tick = () => api('tournament_tick', { id: tid }).catch(() => {});
    const every = setInterval(tick, 30_000);
    const atDeadline = nextDeadline ? setTimeout(tick, Math.max(0, nextDeadline - Date.now() + 1500)) : undefined;
    return () => {
      clearInterval(every);
      clearTimeout(atDeadline);
    };
  }, [phase, tid, nextDeadline]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await data.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const top = (
    <div className="hub-top">
      <button className="link-btn back" onClick={onBack}>← {t.back}</button>
      <ChipBalance profile={profile} />
    </div>
  );

  if (needPeek) {
    return (
      <div className="screen tour-screen">
        {top}
        {peek && <TournamentInvite peek={peek} busy={busy} onJoin={(entryId) => run(() => api('tournament_join', { id: peek.id, entryId }))} />}
        {!peek && !error && <p className="fine">{t.loading}</p>}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  if (!data.t) return <div className="screen tour-screen">{top}<p className="fine">{t.loading}</p></div>;

  return (
    <div className="screen tour-screen">
      {top}
      <TournamentView
        tour={data.t} entries={data.entries} matches={data.matches} checkins={data.checkins} names={data.names} uid={uid} busy={busy}
        onStart={() => run(() => api('tournament_start', { id: tid }))}
        onCheckIn={() => run(() => api('tournament_checkin', { id: tid }))}
        onCancel={() => confirm(t.tour.cancelConfirm) && run(() => api('tournament_cancel', { id: tid }))}
        onLeave={() => confirm(t.tour.leaveConfirm) && run(async () => { await api('tournament_leave', { id: tid }); onBack(); })}
        onKick={(userId) => confirm(t.tour.kickConfirm) && run(() => api('tournament_kick', { id: tid, userId }))}
        onPlay={onRoom}
        onWatch={onWatch && tid ? (roomId) => onWatch(roomId, tid) : undefined}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export interface TournamentViewProps {
  tour: TournamentRow;
  entries: EntryRow[];
  matches: MatchRow[];
  /** Who has checked in (scheduled tournaments). */
  checkins?: Set<string>;
  names: Record<string, string>;
  uid: string;
  busy?: boolean;
  onStart: () => void;
  onCheckIn?: () => void;
  onCancel: () => void;
  onLeave: () => void;
  onKick: (userId: string) => void;
  onPlay: (roomId: string) => void;
  /** Watch a match being played (every member may). */
  onWatch?: (roomId: string) => void;
}

/** Everything a member sees: sign-ups before the start, then the bracket. */
export function TournamentView(p: TournamentViewProps) {
  const { t, lang } = useI18n();
  const { tour, entries, matches, names, uid } = p;
  const checkins = p.checkins ?? new Set<string>();
  const isHost = tour.host === uid;
  const mine = entries.find((e) => e.player1 === uid || e.player2 === uid) ?? null;
  const people = entries.reduce((n, e) => n + (e.player2 ? 2 : 1), 0);
  const capacity = tour.size * playersPerEntry(tour.mode);
  const { first, second } = purse(tour.pot);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const nameOf = (pid: string) => `${names[pid] ?? '…'}${pid === uid ? ` (${t.tour.you})` : ''}`;
  const label = (entryId: string | null) => {
    const e = entryId ? byId.get(entryId) : null;
    return e ? [e.player1, e.player2].filter((x): x is string => !!x).map((x) => names[x] ?? '…').join(' & ') : t.tour.tbd;
  };
  const scheduled = tour.phase === 'lobby' && tour.starts_at ? new Date(tour.starts_at).getTime() : null;
  const now = useNow(scheduled !== null || matches.some((m) => m.status === 'ready'));
  const players = entries.flatMap((e) => [e.player1, e.player2].filter((x): x is string => !!x));
  const checkInIsOpen = scheduled !== null && checkInOpen(scheduled, now);
  const here = players.filter((x) => checkins.has(x)).length;
  const iAmIn = players.includes(uid);
  // The champion's moment: once per tournament on this device, the first time they see it over.
  const champEntry = tour.phase === 'finished' ? entries.find((e) => e.placement === 1) ?? null : null;
  const [celebrated, setCelebrated] = useState(false);
  const celebrate = !!champEntry && !!mine && mine.id === champEntry.id && !celebrated && !trophySeen(tour.id);

  return (
    <>
      <header className="lobby-title">
        <h2>🏆 {tour.name}</h2>
        <div className="rule-chips">
          <span className={`phase-chip ${tour.phase}`}>{t.tour.phase[tour.phase]}</span>
          <span>{t.modes[tour.mode].name}</span>
          <span>{t.targetLbl} {tour.rules.target}</span>
          <span>{tour.buy_in ? `🪙 ${tour.buy_in.toLocaleString()}` : t.free}</span>
          <span>⏱ {tour.turn_seconds}s</span>
        </div>
      </header>
      {scheduled !== null && (
        <section className={`card tour-clock ${checkInIsOpen ? 'open' : ''}`}>
          <div className="tc-when">
            <b>🕘 {t.tour.startsAt.replace('{when}', whenText(scheduled, lang, t))}</b>
            <span>{scheduled > now ? t.tour.inTime.replace('{t}', untilText(scheduled - now)) : t.tour.starting}</span>
          </div>
          {!checkInIsOpen && <p className="fine left">{t.tour.checkInOpensAt.replace('{time}', timeOf(scheduled - TOURNAMENT.checkInMs, lang))}</p>}
          {checkInIsOpen && iAmIn && (checkins.has(uid)
            ? <p className="tc-done">{t.tour.checkedIn}</p>
            : (
              <>
                <p className="fine left">{t.tour.checkInNow}</p>
                <button className="btn primary wide tc-btn" disabled={p.busy} onClick={p.onCheckIn}>{t.tour.checkIn}</button>
              </>
            ))}
          {checkInIsOpen && <small className="tc-count">{t.tour.checkedCount.replace('{n}', String(here)).replace('{total}', String(players.length))}</small>}
        </section>
      )}

      {tour.buy_in > 0 && (
        <div className="tour-pot">
          <span>{t.tour.pot}</span>
          <b>🪙 {tour.pot.toLocaleString()}</b>
          <small>🥇 {first.toLocaleString()} · 🥈 {second.toLocaleString()}</small>
        </div>
      )}

      {tour.phase === 'lobby' && (
        <>
          <ShareBox id={tour.id} code={tour.code} name={tour.name} />
          <section className="card tour-entries">
            <div className="te-head"><span className="label">{t.tour.signedUp}</span><b>{people}/{capacity} {t.tour.people}</b></div>
            {entries.map((e) => (
              <div key={e.id} className={`te-row ${e === mine ? 'mine' : ''}`}>
                {[e.player1, e.player2].map((pid, i) => pid ? (
                  <span key={i} className={`te-name ${checkInIsOpen && checkins.has(pid) ? 'here' : ''}`}>
                    {checkInIsOpen && checkins.has(pid) && <i className="te-here" aria-label="check-in">✓</i>}
                    {pid === tour.host && '👑 '}{nameOf(pid)}
                    {isHost && pid !== uid && <button className="te-kick" onClick={() => p.onKick(pid)} aria-label="✕">✕</button>}
                  </span>
                ) : tour.mode === '2v2' ? <span key={i} className="te-open">{t.tour.lookingPartner}</span> : null)}
              </div>
            ))}
          </section>
          {tour.mode === '2v2' && <p className="fine">{t.tour.soloNote}</p>}
          {scheduled !== null ? (
            <>
              {isHost && (
                <>
                  {checkInIsOpen && here === players.length && people >= TOURNAMENT.minPlayers
                    ? <button className="btn primary wide" disabled={p.busy} onClick={p.onStart}>{t.tour.startNow}</button>
                    : <p className="fine">{t.tour.autoStart} {checkInIsOpen ? t.tour.startNowHint : ''}</p>}
                  <p className="fine">{t.tour.minPeople}</p>
                  <button className="link-btn signout" onClick={p.onCancel}>{t.tour.cancel}</button>
                </>
              )}
              {!isHost && <button className="link-btn signout" onClick={p.onLeave}>{t.tour.leave}</button>}
            </>
          ) : isHost ? (
            <>
              <button className="btn primary wide" disabled={p.busy || people < TOURNAMENT.minPlayers} onClick={p.onStart}>{t.tour.start}</button>
              <p className="fine">{t.tour.minPeople}</p>
              <button className="link-btn signout" onClick={p.onCancel}>{t.tour.cancel}</button>
            </>
          ) : (
            <>
              <p className="fine">{t.tour.waitingHost}</p>
              <button className="link-btn signout" onClick={p.onLeave}>{t.tour.leave}</button>
            </>
          )}
        </>
      )}

      {tour.phase === 'finished' && (() => {
        const champ = entries.find((e) => e.placement === 1);
        const runner = entries.find((e) => e.placement === 2);
        if (!champ) {
          const finalists = entries.filter((e) => e.placement === 2);
          return (
            <div className="tour-champion">
              <span className="trophy">🤝</span>
              <small>{finalists.length ? t.tour.sharedFinal.replace('{names}', finalists.map((e) => label(e.id)).join(' · ')) : t.tour.nobodyFinal}</small>
            </div>
          );
        }
        const semis = entries.filter((e) => e.placement === 3);
        return (
          <section className="tour-podium" aria-label={t.tour.champion}>
            <TrophyCup size={112} className="champion-cup" />
            <span className="podium-label">{mine?.id === champ.id ? t.tour.youWon : t.tour.champion}</span>
            <b className="champ-name">{label(champ.id)}</b>
            {tour.pot > 0 && <small className="podium-prize">{t.tour.prize}: 🪙 {first.toLocaleString()}</small>}
            {(runner || semis.length > 0) && (
              <div className="podium-rest">
                {runner && (
                  <div className="podium-row">
                    <TrophyCup size={30} metal="silver" />
                    <span><small>{t.tour.runnerUp}</small><b>{label(runner.id)}</b></span>
                    {tour.pot > 0 && <small className="podium-prize">🪙 {second.toLocaleString()}</small>}
                  </div>
                )}
                {semis.length > 0 && (
                  <div className="podium-row">
                    <TrophyCup size={30} metal="bronze" />
                    <span><small>{t.tour.semifinalists}</small><b>{semis.map((e) => label(e.id)).join(' · ')}</b></span>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })()}
      {celebrate && champEntry && (
        <ChampionCelebration tournament={tour.name} names={label(champEntry.id)} prize={first} pair={tour.mode === '2v2'}
          onClose={() => { markTrophySeen(tour.id); setCelebrated(true); }} />
      )}

      {tour.phase === 'playing' && mine && (() => {
        if (mine.eliminated_round && tour.rounds) {
          return (
            <div className="tour-me out">
              {t.tour.outIn} {t.tour.stages[stage(mine.eliminated_round, tour.rounds)].toLowerCase()}
              {p.onWatch && <small>{t.tour.watchHint}</small>}
            </div>
          );
        }
        const next = matches.filter((m) => m.status !== 'done' && (m.entry_a === mine.id || m.entry_b === mine.id)).sort((a, b) => a.round - b.round)[0];
        if (next?.room_id && next.status === 'ready') {
          return (
            <div className="tour-me ready">
              <strong>{t.tour.yourMatchReady}</strong>
              <span>{tour.mode === '2v2' ? t.tour.readyRule2v2 : t.tour.readyRule}</span>
              <b className="ready-secs">{next.ready_by ? clock(new Date(next.ready_by).getTime() - now) : ''}</b>
              <button className="btn primary wide" onClick={() => p.onPlay(next.room_id!)}>▶ {t.tour.play}</button>
            </div>
          );
        }
        if (next?.room_id && next.status === 'playing') {
          return (
            <div className="tour-me live">
              <strong>{t.tour.yourMatchLive}</strong>
              <button className="btn primary wide" onClick={() => p.onPlay(next.room_id!)}>▶ {t.tour.play}</button>
            </div>
          );
        }
        return <div className="tour-me">{t.tour.waitingOpponent}</div>;
      })()}

      {(tour.phase === 'playing' || tour.phase === 'finished') && tour.rounds && (
        <div className="bracket" style={{ '--rounds': tour.rounds } as CSSProperties}>
          {Array.from({ length: tour.rounds }, (_, i) => i + 1).map((r) => (
            <div key={r} className="br-round">
              <h4>{t.tour.stages[stage(r, tour.rounds!)]}</h4>
              <div className="br-matches">
                {matches.filter((m) => m.round === r).map((m) => (
                  <MatchCard key={m.id} m={m} mine={mine} label={label} now={now} onPlay={p.onPlay} onWatch={p.onWatch} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tour.phase === 'cancelled' && (
        <p className="note-ok center">{tour.cancel_reason === 'not_enough' ? t.tour.cancelledNotEnough : t.tour.phase.cancelled}</p>
      )}
    </>
  );
}

function MatchCard({ m, mine, label, now, onPlay, onWatch }: {
  m: MatchRow; mine: EntryRow | null; label: (id: string | null) => string; now: number; onPlay: (roomId: string) => void;
  onWatch?: (roomId: string) => void;
}) {
  const { t } = useI18n();
  const isMine = !!mine && (m.entry_a === mine.id || m.entry_b === mine.id);
  const loser = m.winner ? (m.winner === m.entry_a ? m.entry_b : m.entry_a) : null;
  const nobody = m.result === 'no_show';
  const side = (entryId: string | null, key: string) => {
    const won = !!m.winner && m.winner === entryId;
    const lost = (!!m.winner || nobody) && !!entryId && m.winner !== entryId;
    const text = entryId ? label(entryId) : m.result === 'bye' ? t.tour.bye : nobody ? '—' : t.tour.tbd;
    return (
      <div key={key} className={`br-side ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${mine && entryId === mine.id ? 'me' : ''} ${entryId ? '' : 'empty'}`}>
        <span>{text}</span>{won && <b>✓</b>}
      </div>
    );
  };
  let status = '';
  if (m.status === 'ready' && m.ready_by) status = `${t.tour.readyIn} ${clock(new Date(m.ready_by).getTime() - now)}`;
  else if (m.status === 'playing') status = `● ${t.tour.live}`;
  else if (m.result === 'forfeit' && loser) status = `${label(loser)} ${t.tour.forfeit}`;
  else if (nobody && (m.entry_a || m.entry_b)) status = t.tour.noShow;
  return (
    <div className={`br-match ${isMine ? 'mine' : ''} ${m.status}`}>
      {side(m.entry_a, 'a')}
      {side(m.entry_b, 'b')}
      {status && <small className="br-status">{status}</small>}
      {isMine && m.room_id && (m.status === 'ready' || m.status === 'playing') && (
        <button className="btn primary br-play" onClick={() => onPlay(m.room_id!)}>▶ {t.tour.play}</button>
      )}
      {!isMine && onWatch && m.room_id && m.status === 'playing' && (
        <button className="btn ghost br-play br-watch" onClick={() => onWatch(m.room_id!)}>{t.tour.watch}</button>
      )}
    </div>
  );
}

function ShareBox({ id, code, name }: { id: string; code: string; name: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const social = useSocial();
  const url = inviteUrl(code);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${t.tour.inviteText} «${name}» — ${t.tour.codeLbl}: ${code} 👉 ${url}`)}`;
  return (
    <section className="card tour-share">
      <span className="label center">{t.tour.codeLbl}</span>
      <div className="room-code">{code}</div>
      <div className="share-row">
        <a className="btn wa" href={wa} target="_blank" rel="noreferrer">{t.invite}</a>
        <button className="btn ghost" onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
        }}>{copied ? t.copied : t.copyLink}</button>
      </div>
      {social && <button className="btn primary wide invite-friends-btn" onClick={() => setInviting(true)}>👥 {t.social.inviteFriends}</button>}
      {inviting && <InviteFriendsSheet target={{ tournamentId: id }} onClose={() => setInviting(false)} />}
    </section>
  );
}

// ---------- invite ----------

export function TournamentInvite({ peek, busy, onJoin }: { peek: TournamentPeek; busy: boolean; onJoin: (entryId?: string) => void }) {
  const { t, lang } = useI18n();
  const people = peek.entries.reduce((n, e) => n + e.names.length, 0);
  const capacity = peek.size * (peek.mode === '2v2' ? 2 : 1);
  const full = people >= capacity;
  const startsAt = peek.startsAt ? new Date(peek.startsAt).getTime() : null;
  const now = useNow(startsAt !== null);
  const open = peek.phase === 'lobby' && (startsAt === null || startsAt > now);
  const { first, second } = purse(peek.pot);
  return (
    <>
      <header className="lobby-title">
        <h2>🏆 {peek.name}</h2>
        <p className="fine">{t.tour.hostedBy} {peek.host}</p>
        <div className="rule-chips">
          <span className={`phase-chip ${peek.phase}`}>{t.tour.phase[peek.phase]}</span>
          <span>{t.modes[peek.mode].name}</span>
          <span>{t.targetLbl} {peek.target}</span>
          <span>{peek.buyIn ? `🪙 ${peek.buyIn.toLocaleString()}` : t.free}</span>
        </div>
        {startsAt !== null && open && (
          <p className="tour-when">🕘 {t.tour.startsAt.replace('{when}', whenText(startsAt, lang, t))} · {t.tour.inTime.replace('{t}', untilText(startsAt - now))}</p>
        )}
      </header>
      {startsAt !== null && open && <p className="fine">{t.tour.checkInRule}</p>}
      {peek.buyIn > 0 && (
        <div className="tour-pot">
          <span>{t.tour.pot}</span>
          <b>🪙 {peek.pot.toLocaleString()}</b>
          <small>🥇 {first.toLocaleString()} · 🥈 {second.toLocaleString()}</small>
        </div>
      )}
      <section className="card tour-entries">
        <div className="te-head"><span className="label">{t.tour.signedUp}</span><b>{people}/{capacity} {t.tour.people}</b></div>
        {peek.entries.map((e) => (
          <div key={e.id} className="te-row">
            <span className="te-name">{e.names.join(' & ')}</span>
            {e.open && <span className="te-open">{t.tour.lookingPartner}</span>}
            {e.open && open && !full && (
              <button className="btn ghost te-join" disabled={busy} onClick={() => onJoin(e.id)}>{t.tour.joinPair} {e.names[0]}</button>
            )}
          </div>
        ))}
      </section>
      {!open ? (
        <p className="fine">{t.tour.alreadyStarted}</p>
      ) : (
        <>
          <button className="btn primary wide" disabled={busy || full} onClick={() => onJoin()}>
            {peek.mode === '2v2' ? t.tour.newPair : t.tour.join}{peek.buyIn > 0 ? ` · 🪙 ${peek.buyIn.toLocaleString()}` : ''}
          </button>
          {peek.mode === '2v2' && <p className="fine">{t.tour.soloNote}</p>}
        </>
      )}
    </>
  );
}

// ---------- in the Tables tab ----------

export function TournamentsSection({ uid, onCreate, onOpen }: { uid: string; onCreate: () => void; onOpen: (id: string) => void }) {
  const { t, lang } = useI18n();
  const list = useMyTournaments(uid);
  return (
    <section className="tour-section">
      <h3 className="section-title">🏆 {t.tour.title}</h3>
      <p className="fine left">{t.tour.sub}</p>
      <button className="btn primary" onClick={onCreate}>＋ {t.tour.create}</button>
      {list && list.length > 0 && (
        <div className="tour-list">
          <span className="label">{t.tour.mine}</span>
          {list.map((x) => (
            <button key={x.id} className="tour-row" onClick={() => onOpen(x.id)}>
              <span className="tr-name">{x.name}</span>
              <span className="tr-meta">
                {t.modes[x.mode].name} · {x.buy_in ? `🪙 ${x.buy_in.toLocaleString()}` : t.free}
                {x.phase === 'lobby' && x.starts_at && ` · 🕘 ${whenText(new Date(x.starts_at).getTime(), lang, t)}`}
              </span>
              <span className={`phase-chip ${x.phase}`}>{t.tour.phase[x.phase]}</span>
            </button>
          ))}
        </div>
      )}
      {list && list.length === 0 && <p className="fine">{t.tour.none}</p>}
    </section>
  );
}

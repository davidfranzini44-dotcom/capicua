import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { seatsOf, type Mode, type Move, type Ruleset, type Seat } from '../../supabase/functions/_shared/domino.ts';
import {
  botsAllowed, minHumans, SIDE_BET_KINDS, sideBetLimit, sideBetMultiplier, voiceRoomFor, type SideBetKind,
} from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { OUT_OF_APP_MS, useFairPlay, type TableAlert } from '../lib/fairPlay';
import { forgetTable, rememberTable } from '../lib/lastTable';
import { api, ApiError, supabase, type Profile } from '../lib/supabase';
import { usePlayerStats, useRoom, type PlayerStats, type RoomData, type SeatRow } from '../lib/useRoom';
import { useSocial } from '../lib/social';
import { useWatchers } from '../lib/watch';
import { useVoice, type Voice } from '../lib/useVoice';
import { COOLDOWN_MS, type PhraseId } from '../quickchat';
import type { ChestKind } from '../../supabase/functions/_shared/table.ts';
import { ChestArt } from './Chests';
import { Avatar, ChipBalance, LevelBadge, useErrorText } from './common';
import { InviteFriendsSheet } from './Friends';
import { ProfileCard } from './ProfileCard';
import { ReportButton } from './Report';
import { TableView } from './TableView';
import { VoiceButton } from './VoiceButton';

const SIDE_COLORS = ['var(--us)', '#6fb7ff', 'var(--them)', '#c79bff'];
/** Games whose "fair play" reminder this device already showed. */
const fairReminded = new Set<string>();

export function RoomScreen({ roomId, uid, profile, onLeave, onBrokeUp, onRequeue, onTournament }: {
  roomId: string; uid: string; profile: Profile;
  onLeave: () => void; onBrokeUp: () => void; onRequeue: (stake: number, mode: Mode, ruleset?: Ruleset) => void; onTournament: (id: string) => void;
}) {
  const r = useRoom(roomId, uid);
  const me = r.seats.find((s) => s.user_id === uid);
  const myVoiceRoom = r.room && me ? voiceRoomFor(r.room.kind, r.room.mode, r.room.code, me.seat) : null;
  const voiceOk = myVoiceRoom !== null;
  const voice = useVoice(voiceOk ? roomId : null);

  // Let the table know I'm on voice, so their "Voz" button lights up.
  const { setVoicePresence } = r;
  useEffect(() => setVoicePresence(voice.status === 'on'), [voice.status, setVoicePresence]);
  /** Others at the table on voice that I'd actually hear (public 2v2 voice is teammates only). */
  const othersOnVoice = r.room ? r.seats.filter((s) => s.user_id && s.user_id !== uid && r.inVoice.has(s.user_id)
    && voiceRoomFor(r.room!.kind, r.room!.mode, r.room!.code, s.seat) === myVoiceRoom).length : 0;
  const voiceControl = voiceOk ? <VoiceButton voice={voice} me={uid} others={othersOnVoice} /> : null;

  // Remember this table so a refresh or a reopened tab comes straight back here.
  useEffect(() => rememberTable(roomId), [roomId]);

  // The table broke up (someone declined) or was closed. A tournament table closes on a no-show: back to the bracket.
  const tournamentId = r.room?.tournament_id ?? null;
  useEffect(() => {
    if (!r.gone) return;
    forgetTable();
    if (tournamentId) onTournament(tournamentId);
    else onBrokeUp();
  }, [r.gone, onBrokeUp, onTournament, tournamentId]);

  // Lobby deadlines (countdown / ready check): whoever's here nudges the server when time's up.
  const endsAt = r.room?.phase_ends_at ? new Date(r.room.phase_ends_at).getTime() : null;
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    if (!endsAt || !r.room || !['ready', 'countdown'].includes(r.room.phase)) return;
    const id = setTimeout(() => {
      api<{ phase: string }>('tick_room', { roomId }).then((x) => {
        if (x.phase === r.room!.phase) setTimeout(() => setNudge((n) => n + 1), 1500); // clock skew: try again
      }).catch(() => {});
    }, Math.max(0, endsAt - Date.now() + 250));
    return () => clearTimeout(id);
  }, [endsAt, r.room, roomId, nudge]);

  if (!r.room) return <div className="screen center"><p>…</p></div>;

  const leave = async () => {
    voice.leave();
    // Mid-game this only hands the chair to the server; the game stays yours to come back to.
    const midGame = r.room?.phase === 'playing';
    await api('leave_room', { roomId }).catch(() => {});
    if (!midGame) forgetTable();
    onLeave();
  };

  if (r.room.phase === 'playing' || (r.room.phase === 'finished' && r.game)) {
    if (!r.game) return <div className="screen center"><p>…</p></div>;
    return (
      <OnlineTable
        r={r} uid={uid} voice={voiceOk ? voice : null} voiceControl={voiceControl} onLeave={leave}
        onTournament={tournamentId ? () => { voice.leave(); forgetTable(); onTournament(tournamentId); } : undefined}
        onPlayAnother={async () => {
          voice.leave();
          forgetTable();
          await api('leave_room', { roomId }).catch(() => {});
          onRequeue(r.room!.stake, r.room!.mode, r.room!.rules.ruleset === 'arcade' ? 'arcade' : 'traditional');
        }}
      />
    );
  }
  return <Pregame r={r} uid={uid} profile={profile} voice={voiceOk ? voice : null} voiceControl={voiceControl} onLeave={leave} />;
}

// ---------- pre-game lobby ----------

function useSecondsLeft(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : null;
}

export function Pregame({ r, uid, profile, voice, voiceControl, onLeave }: {
  r: RoomData; uid: string; profile: Profile; voice: Voice | null; voiceControl?: ReactNode; onLeave: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const social = useSocial();
  const room = r.room!;
  const mode = room.mode;
  const me = r.seats.find((s) => s.user_id === uid);
  const isHost = room.host === uid;
  const humanIds = r.seats.filter((s) => s.user_id && !s.is_bot).map((s) => s.user_id!);
  const stats = usePlayerStats(humanIds);
  const secs = useSecondsLeft(room.phase_ends_at);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e) => setError(errText(e)));
  };
  const inviteUrl = `${location.origin}${location.pathname}?sala=${room.code}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${t.inviteText} ${room.code} 👉 ${inviteUrl}`)}`;

  const humansSeated = r.seats.filter((s) => s.user_id && !s.is_bot);
  const everyoneReady = humansSeated.every((s) => s.ready || s.user_id === room.host);
  const enoughPeople = humansSeated.length >= minHumans(mode, room.stake);
  const withBots = botsAllowed(mode, room.stake);
  const seatNote = !withBots ? t.peopleOnly : room.stake > 0 ? t.ffaMinTwo : t.botsFill;

  // Teams (2v2 private tables, before the game): anyone hops to a free chair on the
  // other team; the host can swap any two chairs or shuffle.
  const teamTools = room.kind === 'custom' && room.phase === 'lobby' && mode === '2v2';
  const layout = () => seatsOf(mode).map((s) => r.seats.find((x) => x.seat === s)?.user_id ?? null);
  const freeOnOtherTeam = me ? seatsOf(mode).find((s) => s % 2 !== me.seat % 2 && !r.seats.some((x) => x.seat === s)) : undefined;
  const saveLayout = (next: (string | null)[]) => run(async () => {
    const { error: e } = await supabase.rpc('set_seats', { p_room: room.id, p_users: next });
    if (e) throw new ApiError(['host_only', 'game_in_progress', 'bad_seat', 'room_not_found'].includes(e.message) ? e.message : 'server_error');
  });
  const pickSeat = (seat: number) => {
    if (picked === null) return setPicked(seat);
    setPicked(null);
    if (picked === seat) return;
    const next = layout();
    [next[picked], next[seat]] = [next[seat], next[picked]];
    if (next.some((id, i) => id !== layout()[i])) saveLayout(next);
  };
  const shuffleTeams = () => {
    const now = layout();
    let next = now;
    for (let i = 0; i < 20 && teamsKey(next) === teamsKey(now); i++) next = shuffled(now);
    saveLayout(next);
  };

  return (
    <div className="screen lobby2">
      <div className="hub-top">
        <button className="link-btn back" onClick={() => (room.phase === 'lobby' || confirm(t.exitConfirm)) && onLeave()}>← {t.leave}</button>
        <ChipBalance profile={profile} />
      </div>

      <header className="lobby-title">
        <h2>{room.kind === 'tournament' ? `🏆 ${t.tour.matchTitle}` : room.kind === 'custom' ? `${t.tableCode}: ${room.code}` : room.stake === 0 ? `🤝 ${t.friendly}` : `${t.sala} ${room.stake.toLocaleString()}`}</h2>
        <div className="rule-chips">
          {room.rules.ruleset === 'arcade' ? <>
            <span className="arcade-chip">⚡ {t.arcade.name}</span>
            <span>{t.arcade.goal}</span>
          </> : <>
            <span>{t.modes[mode].name}</span>
            <span>{t.targetLbl} {room.rules.target}</span>
          </>}
          <span>{room.stake ? `🪙 ${room.stake.toLocaleString()}` : t.free}</span>
          <span>⏱ {room.turn_seconds}s</span>
          {room.rules.ruleset !== 'arcade' && room.rules.capicuaBonus === 0 && <span className="off">{t.capicuaBonusLbl}</span>}
          {room.rules.ruleset !== 'arcade' && room.rules.paseCorridoBonus === 0 && <span className="off">{t.paseBonusLbl}</span>}
          {room.rules.ruleset !== 'arcade' && mode === '2v2' && !room.rules.paseSalidaBonus && <span className="off">{t.paseSalidaLbl}</span>}
        </div>
      </header>

      {/* What happens next */}
      {room.phase === 'countdown' && (
        <div className="phase-banner countdown">
          <span>{t.startsIn}</span>
          <b>{secs ?? ''}</b>
        </div>
      )}
      {room.phase === 'ready' && (
        <div className="phase-banner ready">
          <strong>{room.kind === 'tournament' ? t.tour.yourMatchReady : t.readyCheckTitle}</strong>
          <span>{room.kind === 'tournament' ? t.tour.readyRule : t.readyCheckSub}</span>
          <b className="ready-secs">{secs}s</b>
          {me && !me.ready ? (
            <div className="ready-actions">
              <button className="btn primary" onClick={() => run(() => api('ready', { roomId: room.id }))}>{t.imReady}</button>
              {room.kind === 'public' && <button className="btn ghost" onClick={() => run(() => api('decline', { roomId: room.id }))}>{t.noThanks}</button>}
            </div>
          ) : (
            <span className="fine">{t.waitingOthers}</span>
          )}
        </div>
      )}

      <PlayerList
        mode={mode} seats={r.seats} stats={stats} hostId={room.host} uid={uid}
        showReady={room.phase !== 'countdown'} speaking={voice?.speaking}
        canSit={room.kind === 'custom' && room.phase === 'lobby'}
        emptyHint={withBots ? t.botsFill : t.waitingPerson}
        onSit={(seat) => run(() => api('take_seat', { roomId: room.id, seat }))}
        onCard={setCard}
        arrange={arranging ? { picked, onPick: pickSeat } : undefined}
      />

      {teamTools && (
        <div className="team-tools">
          {isHost ? (
            arranging ? (
              <>
                <p className="fine team-hint">{t.teams.arrangeHint}</p>
                <button className="btn ghost" onClick={shuffleTeams}>🔀 {t.teams.shuffle}</button>
                <button className="btn primary" onClick={() => { setArranging(false); setPicked(null); }}>✓ {t.teams.done}</button>
              </>
            ) : (
              <>
                <button className="btn ghost" onClick={() => setArranging(true)}>⇄ {t.teams.arrange}</button>
                <button className="btn ghost" onClick={shuffleTeams}>🔀 {t.teams.shuffle}</button>
              </>
            )
          ) : (
            <>
              <button className="btn ghost" disabled={freeOnOtherTeam === undefined}
                onClick={() => freeOnOtherTeam !== undefined && run(() => api('take_seat', { roomId: room.id, seat: freeOnOtherTeam }))}>
                ⇄ {t.teams.switch}
              </button>
              {freeOnOtherTeam === undefined && <p className="fine team-hint">{t.teams.full}</p>}
            </>
          )}
        </div>
      )}

      {room.kind === 'custom' && room.phase === 'lobby' && (
        <>
          <div className="share-row">
            <a className="btn wa" href={wa} target="_blank" rel="noreferrer">{t.invite}</a>
            <button className="btn ghost" onClick={async () => {
              try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
            }}>{copied ? t.copied : t.copyLink}</button>
          </div>
          {social && <button className="btn primary wide invite-friends-btn" onClick={() => setInviting(true)}>👥 {t.social.inviteFriends}</button>}
          <div className="lobby-actions">
            {voiceControl}
            {isHost ? (
              <button className="btn primary wide" disabled={!everyoneReady || !enoughPeople} onClick={() => run(() => api('start', { roomId: room.id }))}>{t.start}</button>
            ) : (
              <button className={`btn wide ${me?.ready ? 'ghost' : 'primary'}`} onClick={() => run(() => api('ready', { roomId: room.id, ready: !me?.ready }))}>
                {me?.ready ? `✓ ${t.readyTag}` : t.notReady}
              </button>
            )}
          </div>
          <p className={`fine ${withBots ? '' : 'people-only'}`}>{seatNote}</p>
        </>
      )}
      {room.kind === 'public' && voice && (
        <div className="lobby-actions">{voiceControl}<span className="fine grow">{t.teamVoice}</span></div>
      )}
      {room.kind === 'tournament' && voice && <div className="lobby-actions">{voiceControl}</div>}

      {room.kind === 'tournament' ? null
        : room.kind === 'public' && room.stake === 0 ? <p className="fine">{t.friendlyNote}</p>
        : <SideBets r={r} mode={mode} profile={profile} onError={setError} />}
      {error && <p className="error">{error}</p>}
      {card && stats[card] && <ProfileCard stats={stats[card]} onClose={() => setCard(null)} />}
      {inviting && <InviteFriendsSheet target={{ roomId: room.id }} onClose={() => setInviting(false)} />}
    </div>
  );
}

/** Who partners with whom, ignoring which team is called 1 or 2. */
const teamsKey = (l: (string | null)[]) =>
  [[l[0], l[2]], [l[1], l[3]]].map((team) => team.filter(Boolean).sort().join('+')).sort().join('|');
const shuffled = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function PlayerList({ mode, seats, stats, hostId, uid, showReady, speaking, canSit, emptyHint, onSit, onCard, arrange }: {
  mode: Mode; seats: SeatRow[]; stats: Record<string, PlayerStats>; hostId: string | null; uid: string;
  showReady: boolean; speaking?: Set<string>; canSit: boolean; emptyHint: string; onSit: (seat: number) => void; onCard: (id: string) => void;
  /** Host is arranging teams: every chair is tappable, two taps swap them. */
  arrange?: { picked: number | null; onPick: (seat: number) => void };
}) {
  const { t } = useI18n();
  // Group by side: teams in 2v2, one per player otherwise.
  const groups = mode === '2v2' ? [[0, 2], [1, 3]] : seatsOf(mode).map((s) => [s]);
  return (
    <div className={`player-list mode-${mode}`}>
      {groups.map((g, gi) => (
        <div key={gi} className="side-group" style={{ '--side-color': SIDE_COLORS[gi] } as CSSProperties}>
          {mode === '2v2' && <span className="side-label">{gi === 0 ? t.team1 : t.team2}</span>}
          {g.map((seat) => {
            const s = seats.find((x) => x.seat === seat);
            if (!s) {
              return (
                <button key={seat} className={`player-card empty ${arrange ? 'pickable' : ''} ${arrange?.picked === seat ? 'picked' : ''}`}
                  disabled={!canSit && !arrange} onClick={() => (arrange ? arrange.onPick(seat) : onSit(seat))}>
                  <span className="avatar">+</span>
                  <span className="pc-main"><b>{t.emptySeat}</b><small>{canSit ? t.sitHere : emptyHint}</small></span>
                </button>
              );
            }
            const st = s.user_id ? stats[s.user_id] : undefined;
            const winRate = st && st.games ? Math.round((100 * st.wins) / st.games) : null;
            const talking = !!s.user_id && !!speaking?.has(s.user_id);
            return (
              <button key={seat}
                className={`player-card ${s.user_id === uid ? 'me' : ''} ${talking ? 'speaking' : ''} ${arrange ? 'pickable' : ''} ${arrange?.picked === seat ? 'picked' : ''}`}
                disabled={!st && !arrange} onClick={() => (arrange ? arrange.onPick(seat) : st && onCard(st.id))}>
                <span className="avatar">
                  {talking && <span className="talk-ring" aria-hidden />}
                  <Avatar name={s.name} url={st?.avatar_url} />
                </span>
                <span className="pc-main">
                  <b>{s.name}{hostId && s.user_id === hostId && ' 👑'}{s.is_bot && <small className="bot-tag"> {t.bot}</small>}</b>
                  {st ? <LevelBadge xp={st.xp} /> : <span className="level-badge"><b>{s.level}</b></span>}
                </span>
                <span className="pc-stats">
                  {winRate !== null && <small>{winRate}% {t.stats.winRate.toLowerCase()}</small>}
                  {st && st.capicuas > 0 && <small>{st.capicuas} cap.</small>}
                </span>
                {showReady && !s.is_bot && <span className={`ready-dot ${s.ready || (hostId && s.user_id === hostId) ? 'on' : ''}`}>{s.ready || (hostId && s.user_id === hostId) ? '✓' : '…'}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SideBets({ r, mode, profile, onError }: { r: RoomData; mode: Mode; profile: Profile; onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const room = r.room!;
  const open = r.bets.filter((b) => b.status === 'open');
  const used = open.reduce((a, b) => a + b.amount, 0);
  const limit = sideBetLimit(room.stake);
  if (!room.stake) return <p className="fine">{t.noSideBets}</p>;
  const amounts = [0.1, 0.25, 0.5, 1].map((f) => Math.max(10, Math.round((room.stake * f) / 10) * 10));
  const solo = mode !== '2v2';

  const place = (kind: SideBetKind, amount: number) =>
    api('side_bet', { roomId: room.id, kind, amount }).then(() => r.reload()).catch((e) => onError(errText(e)));
  const cancel = (kind: SideBetKind) =>
    api('cancel_side_bet', { roomId: room.id, kind }).then(() => r.reload()).catch((e) => onError(errText(e)));

  return (
    <section className="card side-bets">
      <div className="card-head">
        <h3>🎲 {t.sideBets}</h3>
        <small className="fine">{t.sideBetsSub} {limit.toLocaleString()} ({used.toLocaleString()})</small>
      </div>
      {SIDE_BET_KINDS.map((kind) => {
        const mult = sideBetMultiplier(room.rules, kind);
        if (!mult) return null;
        const placed = open.find((b) => b.kind === kind);
        return (
          <div key={kind} className={`bet-row ${placed ? 'placed' : ''}`}>
            <div className="bet-label">
              <b>{solo ? t.bets[kind].solo : t.bets[kind].team}</b>
              <small>{t.pays} <strong>{mult}x</strong></small>
            </div>
            {placed ? (
              <div className="bet-placed">
                <span>{placed.amount.toLocaleString()} → <b>{Math.floor(placed.amount * placed.multiplier).toLocaleString()}</b></span>
                <button className="link-btn" onClick={() => cancel(kind)}>{t.remove}</button>
              </div>
            ) : (
              <div className="bet-amounts">
                {amounts.map((a) => (
                  <button key={a} className="stake" disabled={a + used > limit || a > profile.chips} onClick={() => place(kind, a)}>{a.toLocaleString()}</button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export { ProfileCard };

// ---------- the table ----------

export function OnlineTable({ r, uid, voice, voiceControl, onLeave, onPlayAnother, onTournament }: {
  r: RoomData; uid: string; voice: Voice | null; voiceControl?: ReactNode;
  onLeave: () => void; onPlayAnother: () => void; onTournament?: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const [lastSaid, setLastSaid] = useState(0);
  const [retry, setRetry] = useState(0);
  const [net, setNet] = useState<number | null>(null);
  const [chest, setChest] = useState<ChestKind | null>(null);
  const room = r.room!;
  const game = r.game!;
  const watchers = useWatchers(room.id);
  // Messages at the table fade on their own (they show under the hand, not over the board).
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(id);
  }, [error]);
  const view = game.public_state;
  const me = r.seats.find((s) => s.user_id === uid);
  const mySeat = (me?.seat ?? 0) as Seat;

  const seatOf = useMemo(() => {
    const m = new Map<string, Seat>();
    r.seats.forEach((s) => s.user_id && m.set(s.user_id, s.seat));
    return m;
  }, [r.seats]);
  const names = [0, 1, 2, 3].map((s) => r.seats.find((x) => x.seat === s)?.name ?? '');
  const levels = [0, 1, 2, 3].map((s) => r.seats.find((x) => x.seat === s)?.level ?? null);
  const stats = usePlayerStats(r.seats.filter((s) => s.user_id && !s.is_bot).map((s) => s.user_id!));
  const avatars = [0, 1, 2, 3].map((s) => {
    const id = r.seats.find((x) => x.seat === s)?.user_id;
    return (id && stats[id]?.avatar_url) || null;
  });
  const toSeats = (ids: Set<string>) => new Set([...ids].map((id) => seatOf.get(id)).filter((s): s is Seat => s !== undefined));

  // Fair play: my app tells the table when I leave it mid-game; theirs tell me.
  useFairPlay(room.id, !!me && room.phase === 'playing' && !game.settled && view.winner === null);
  const outOfApp = new Set(Object.values(r.alerts)
    .filter((a) => a.kind === 'left' && a.user_id !== uid && Date.now() - a.at < OUT_OF_APP_MS)
    .map((a) => a.seat as Seat));
  const [shownAlert, setShownAlert] = useState<TableAlert | null>(null);
  useEffect(() => {
    if (!r.lastAlert) return;
    setShownAlert(r.lastAlert);
    const id = setTimeout(() => setShownAlert(null), 4000);
    return () => clearTimeout(id);
  }, [r.lastAlert]);
  const [reminder, setReminder] = useState(false);
  useEffect(() => {
    if (game.settled || fairReminded.has(game.id)) return;
    fairReminded.add(game.id);
    setReminder(true);
    setTimeout(() => setReminder(false), 5000);
  }, [game.id, game.settled]);
  const fairNotice = (() => {
    const a = shownAlert;
    if (!a) return reminder ? t.fair.start : null;
    const mine = a.user_id === uid;
    const who = names[a.seat] || '?';
    const secs = String(a.seconds ?? 0);
    if (a.kind === 'left') return mine ? null : t.fair.left.replace('{name}', who);
    if (a.kind === 'back') return (mine ? t.fair.youLeft : t.fair.back.replace('{name}', who)).replace('{s}', secs);
    return mine ? t.fair.youShot : t.fair.screenshot.replace('{name}', who);
  })();
  // Tapping a player opens their card: mute them on voice, add them, report them.
  const [card, setCard] = useState<string | null>(null);
  const cardStats = card ? stats[card] : undefined;
  const speaking = voice ? toSeats(voice.speaking) : undefined;
  const mutedSeats = voice ? toSeats(voice.mutedPeers) : undefined;
  const away = new Set(r.seats.filter((s) => s.away).map((s) => s.seat));
  // Presence: whose phone has this table open. Only trusted once our own presence has synced.
  const presenceReady = r.online.has(uid);
  const isOnline = (s: SeatRow) => !presenceReady || (!!s.user_id && r.online.has(s.user_id));
  const offline = new Set(r.seats.filter((s) => !s.is_bot && s.user_id !== uid && !isOnline(s)).map((s) => s.seat));

  // The server acts on its own (bots, draws/passes, timeouts, next hand) but only when someone
  // calls `tick`. The lowest-seated player who's connected does it on time; others back them up.
  const tickerId = r.seats.filter((s) => s.user_id && !s.is_bot && isOnline(s)).sort((a, b) => a.seat - b.seat)[0]?.user_id;
  useEffect(() => {
    if (game.auto_delay_ms == null) return;
    const ticker = { user_id: tickerId };
    const slack = ticker?.user_id === uid ? 120 : 4000;
    const wait = Math.max(0, r.receivedAt + game.auto_delay_ms + slack - Date.now());
    const id = setTimeout(() => {
      api<{ acted: boolean }>('tick', { gameId: game.id })
        .then((res) => { if (!res.acted) setTimeout(() => setRetry((n) => n + 1), 1500); })
        .catch(() => setTimeout(() => setRetry((n) => n + 1), 3000));
    }, wait);
    return () => clearTimeout(id);
  }, [game.id, game.version, game.auto_delay_ms, r.receivedAt, tickerId, uid, retry]);

  // Server playing for me? Any touch on the table means I'm back.
  const reclaiming = useRef(false);
  const imBack = () => {
    if (!me?.away || reclaiming.current || room.phase !== 'playing') return;
    reclaiming.current = true;
    api('im_back', { roomId: room.id }).catch(() => {}).finally(() => { reclaiming.current = false; });
  };

  // Turn timer: only while a present human has a real choice to make (the server's
  // own delay equals the turn length exactly then — draws/passes/bots are shorter).
  const turnSeat = r.seats.find((s) => s.seat === view.turn);
  const turnDeadline = turnSeat && !turnSeat.is_bot && !turnSeat.away && game.auto_delay_ms === game.turn_ms
    ? r.receivedAt + game.turn_ms
    : null;

  // Game over: how did my chips do? (stake, pot share, side bets for this game)
  useEffect(() => {
    if (!game.settled) return;
    supabase.from('chip_ledger').select('delta').eq('game_id', game.id).eq('user_id', uid).then(({ data }) => {
      const ledger = (data ?? []).reduce((a, x) => a + Number(x.delta), 0);
      const betsIn = r.bets.filter((b) => b.game_id === game.id).reduce((a, b) => a + b.amount, 0);
      setNet(ledger - betsIn);
    });
    supabase.from('chests').select('kind').eq('game_id', game.id).eq('user_id', uid).maybeSingle()
      .then(({ data }) => setChest((data?.kind as ChestKind) ?? null));
  }, [game.settled, game.id, uid, r.bets]);

  const onPlay = (move: Move) => {
    setError(null);
    // Arcade: an id per action (a retry never repeats it) and the state I saw (an older one is refused).
    const arcade = game.public_state.arcade ? { actionId: crypto.randomUUID(), version: game.version } : {};
    api('move', { gameId: game.id, move, ...arcade }).catch((e) => {
      setError(errText(e));
      r.reload();
    });
  };

  const onChat = (id: PhraseId) => {
    if (Date.now() - lastSaid < COOLDOWN_MS) return;
    setLastSaid(Date.now());
    r.sendChat(mySeat, id);
  };

  const isHost = room.host === uid;
  const wonBets = r.bets.filter((b) => b.game_id === game.id && b.status === 'won');
  const resultNote = view.winner !== null && net !== null ? (
    <>
      {(game.stake > 0 || net !== 0) && (
        <div className={`reward chips ${net >= 0 ? 'up' : 'down'}`}>
          <span>🪙</span><b>{net >= 0 ? '+' : '−'}{Math.abs(net).toLocaleString()}</b>
        </div>
      )}
      {chest && (
        <div className="reward chest">
          <ChestArt kind={chest} className="bounce-in" /><b>{t.chest.names[chest]}</b>
        </div>
      )}
      {wonBets.map((b) => <small key={b.kind} className="bet-won">✓ {t.betWon}: {t.bets[b.kind][room.mode === '2v2' ? 'team' : 'solo']} +{b.payout.toLocaleString()}</small>)}
    </>
  ) : null;

  const endActions = room.kind === 'tournament' ? (
    <>
      {onTournament && <button className="btn primary" onClick={onTournament}>🏆 {t.tour.back}</button>}
      <button className="btn ghost" onClick={onLeave}>{t.exit}</button>
    </>
  ) : room.kind === 'public' ? (
    <>
      <button className="btn primary" onClick={onPlayAnother}>{t.playAnother}</button>
      <button className="btn ghost" onClick={onLeave}>{t.exit}</button>
    </>
  ) : isHost ? (
    <>
      <button className="btn primary" onClick={() => api('rematch', { roomId: room.id }).catch((e) => setError(errText(e)))}>{t.rematch}</button>
      <button className="btn ghost" onClick={onLeave}>{t.leave}</button>
    </>
  ) : (
    <>
      <p className="fine">{t.waitingRematch}</p>
      <button className="btn ghost" onClick={onLeave}>{t.leave}</button>
    </>
  );

  return (
    <div className="online-table" onPointerDown={imBack}>
      <TableView
        view={view}
        myHand={r.hand}
        mySeat={mySeat}
        names={names}
        levels={levels}
        avatars={avatars}
        onPlay={onPlay}
        onNextHand={() => api('next_hand', { gameId: game.id }).catch(() => {})}
        onExit={onLeave}
        chat={r.chat}
        onChat={onChat}
        speaking={speaking}
        mutedSeats={mutedSeats}
        onSeatTap={(s) => {
          const peer = r.seats.find((x) => x.seat === s);
          if (peer?.user_id && !peer.is_bot) setCard(peer.user_id);
        }}
        away={away}
        pot={game.pot || undefined}
        voice={voiceControl ?? undefined}
        turnDeadline={turnDeadline}
        resultNote={resultNote}
        endActions={endActions}
        offline={offline}
        outOfApp={outOfApp}
        exitConfirm={t.exitConfirmOnline}
        notice={error ?? fairNotice}
        watchers={watchers}
        showXp
      />
      {card && cardStats && (
        <ProfileCard
          stats={cardStats}
          onClose={() => setCard(null)}
          actions={(
            <>
              {voice?.status === 'on' && (
                <button className="btn ghost wide" onClick={() => voice.togglePeer(card)}>
                  {voice.mutedPeers.has(card) ? t.fair.unmute : t.fair.mute}
                </button>
              )}
              <ReportButton key={card} userId={card} gameId={game.id} name={cardStats.display_name} />
            </>
          )}
        />
      )}
      {me?.away && room.phase === 'playing' && (
        <div className="away-banner">
          <span>{t.awayBanner}<small>{t.tapToReturn}</small></span>
          <button className="btn primary" onClick={imBack}>{t.imBack}</button>
        </div>
      )}
    </div>
  );
}

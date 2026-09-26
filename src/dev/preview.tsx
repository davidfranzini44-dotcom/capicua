// Dev-only screen gallery: /preview.html?s=main|main-guest|main-out|main-offline|main-profile|queue|ready|countdown|custom|profile|table|board-design|board-motion|away|big-hand|voice|photo|photo-none|custom-guest|notice|missions|home-missions|settings-push|watch|watched|friends|friends-invite|invite-sheet|quick-invite|looks|table-look-<felt>-<tiles>|install-prompt|install-ios|install-ios-inapp|fair-alerts|fair-back|report|fx|fx-win|fx-lose|fx-salida|fx-sounds
// Renders the online screens with sample data so layouts can be checked without a backend.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMove, forcedMove, fullSet, legalMoves, newGame, type Seat } from '../../supabase/functions/_shared/domino.ts';
import { chooseMove } from '../../supabase/functions/_shared/bot.ts';
import { publicRules, publicState } from '../../supabase/functions/_shared/table.ts';
import { LangContext, strings, type Lang } from '../i18n';
import type { Profile } from '../lib/supabase';
import type { Voice } from '../lib/useVoice';
import { VoiceButton } from '../ui/VoiceButton';
import type { RoomData, RoomRow, SeatRow } from '../lib/useRoom';
import '../index.css';
import { CustomForm, MainScreen, PhotoPicker, QueueScreen } from '../ui/Online';
import { OnlineTable, Pregame, ProfileCard } from '../ui/RoomScreen';
import { ChestReveal, ChestSlots } from '../ui/Chests';
import { ShopTab } from '../ui/Shop';
import { TableView } from '../ui/TableView';
import { InstallSheet } from '../ui/MainScreen';
import type { InstallKind } from '../lib/install';
import { TournamentInvite, TournamentView } from '../ui/Tournament';
import type { EntryRow, MatchRow, TournamentRow } from '../lib/useTournament';
import type { GameState } from '../../supabase/functions/_shared/domino.ts';
import { BoardDesignPreview } from './BoardDesignPreview';
import { ArcadePreview } from './arcadePreview';
import { playSfx, preloadSfx } from '../lib/sfx';
import type { Sfx } from '../lib/tableFx';
import { LookContext, type LookState } from '../lib/look';
import { SocialContext, type Friend, type Invite, type Social } from '../lib/social';
import { FriendsSection, InviteFriendsSheet, InviteToast, PushRow, QuickInviteSheet } from '../ui/Friends';
import { MissionsSheet } from '../ui/Missions';
import type { Missions, Mission } from '../lib/missions';
import type { Push } from '../lib/push';
import { HomeTab, SettingsSheet } from '../ui/MainScreen';
import { LookPicker } from '../ui/LookPicker';
import { TileShape } from '../ui/Tile';
import { ReportButton } from '../ui/Report';
import type { TableAlert } from '../lib/fairPlay';
import { lookVars } from '../lib/look';
import { feltById, tilesById } from '../../supabase/functions/_shared/cosmetics.ts';
import '../ui/table.css';

/** A stand-in profile photo (a coloured face) so avatar layouts can be checked offline. */
const face = (bg: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="26" r="12" fill="#f3d2b3"/><path d="M10 64c2-14 12-20 22-20s20 6 22 20z" fill="#f3d2b3"/></svg>`)}`;
const profile: Profile = { id: 'me', display_name: 'Wilfri', chips: 18_450, xp: 1_380, last_daily: null, last_rescue: null, avatar_url: face('#3b7dd8'), friend_code: 'K7M4QX' };

/** Sample friends: one asking, two online, one at a table, one offline, one request out. */
const sampleFriends: Friend[] = [
  { id: 'f-kirsy', name: 'Kirsy', avatar: null, xp: 2_900, state: 'incoming' },
  { id: 'f-yoka', name: 'Yokasta', avatar: face('#c0487a'), xp: 6_200, state: 'friend' },
  { id: 'f-robert', name: 'Robert', avatar: null, xp: 1_100, state: 'friend' },
  { id: 'f-chelo', name: 'Chelo', avatar: face('#2d8a5f'), xp: 4_000, state: 'friend' },
  { id: 'f-papo', name: 'Papo', avatar: null, xp: 300, state: 'friend' },
  { id: 'f-nando', name: 'Nando', avatar: null, xp: 800, state: 'outgoing' },
];
const sampleInvite: Invite = {
  id: 'i1', from_user: 'f-yoka', to_user: 'me', room_id: 'r9', tournament_id: null, status: 'sent',
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  details: { kind: 'room', from: 'Yokasta', mode: '2v2', stake: 500, code: 'QWER', target: 150 },
};
const fakeSocial = (over: Partial<Social> = {}): Social => ({
  uid: 'me', friends: sampleFriends, invites: [], sent: [{ ...sampleInvite, id: 'i2', from_user: 'me', to_user: 'f-robert', room_id: 'r1', status: 'sent' }],
  online: new Map([['f-yoka', 'online'], ['f-robert', 'online'], ['f-chelo', 'playing'], ['f-kirsy', 'online']]),
  stateOf: (id) => sampleFriends.find((f) => f.id === id)?.state ?? 'none',
  request: async () => ({ status: 'pending', name: 'Toño' }), respond: async () => {}, remove: async () => {},
  invite: async () => true, answer: async () => ({ roomId: null, tournamentId: null }), hide: () => {},
  ...over,
});
/** A look state that remembers picks locally, for trying the picker. */
function PreviewLook({ children, felt = 'verde', tiles = 'marfil', xp = 1_500 }: { children: React.ReactNode; felt?: string; tiles?: string; xp?: number }) {
  const [look, setLook] = useState({ felt, tiles, owned: new Set(['jade']) });
  const apply = (id: string) => setLook((l) => (['verde', 'azul', 'vino', 'morado', 'grafito', 'turquesa', 'atardecer'].includes(id) ? { ...l, felt: id } : { ...l, tiles: id }));
  const value: LookState = {
    felt: look.felt, tiles: look.tiles, xp, owned: look.owned, guest: false,
    equip: async (id) => apply(id),
    buy: async (id) => { setLook((l) => ({ ...l, owned: new Set([...l.owned, id]) })); apply(id); },
  };
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}
/** A pretend voice session in a given state, for the voice button previews. */
const fakeVoice = (over: Partial<Voice>): Voice => ({
  status: 'off', micOn: false, micBlocked: false, speaking: new Set(), mutedPeers: new Set(), needsTap: false,
  join: async () => {}, leave: () => {}, setMic: async () => false, enableAudio: () => {}, togglePeer: () => {}, ...over,
});
const inFuture = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function room(over: Partial<RoomRow>): RoomRow {
  return {
    id: 'r1', code: 'KXQT', kind: 'public', mode: '2v2', rules: publicRules('2v2'), stake: 1000, turn_seconds: 15,
    visibility: 'private', host: null, phase: 'countdown', phase_ends_at: inFuture(8), current_game: null, tournament_id: null, ...over,
  };
}
const seat = (s: number, name: string, level: number, over: Partial<SeatRow> = {}): SeatRow => ({
  seat: s as Seat, user_id: name === 'Wilfri' ? 'me' : `u-${name}`, is_bot: false, name, level, ready: false, away: false, left_game: false, ...over,
});

function data(over: Partial<RoomData>): RoomData {
  return {
    room: room({}), seats: [], game: null, hand: [], bets: [], chat: {}, gone: false, online: new Set<string>(), receivedAt: Date.now(), alerts: {}, lastAlert: null,
    sendChat: () => {}, reload: async () => {}, ...over,
  } as RoomData;
}

const fakePush = (state: Push['state']): Push => ({ state, busy: false, toggle: async () => {} });
/** Today's missions: the easy one ready to collect, the medium one done, the hard one under way. */
function fakeMissions(): Missions {
  const resets = new Date(Date.now() + (5 * 60 + 12) * 60_000).toISOString();
  const list: Mission[] = [
    { id: 'play2', tier: 1, kind: 'play', goal: 2, chips: 150, xp: 15, progress: 2, claimed: false, resets_at: resets },
    { id: 'win2', tier: 2, kind: 'win', goal: 2, chips: 300, xp: 30, progress: 2, claimed: true, resets_at: resets },
    { id: 'capicua1', tier: 3, kind: 'capicua', goal: 1, chips: 500, xp: 50, progress: 0, claimed: false, resets_at: resets },
  ];
  const ready = (m: Mission) => !m.claimed && m.progress >= m.goal;
  return {
    missions: list, bonus: { id: 'bonus', tier: 4, kind: 'bonus', goal: 3, chips: 0, xp: 0, progress: 1, claimed: false, resets_at: resets },
    resetsAt: Date.parse(resets), reload: async () => {}, claim: async () => ({ chips: 150, xp: 15 }), ready,
    claimable: 1, done: 2,
  };
}

/**
 * A scripted hand for sounds and bonus pop-ups: Yokasta plays (0.9 s), Robert
 * knocks (1.8 s), pase corrido for Yokasta (2.8 s), then the hand ends on a
 * capicúa (6.5 s) — for us, or for them in fx-lose — and fx-win / fx-lose also
 * end the game. Sounds are logged in window.__sfxLog.
 */
function FxDemo({ end }: { end: 'win' | 'lose' | null }) {
  const base = useMemo(() => {
    let g = newGame(Math.random, publicRules('2v2'));
    for (let i = 0; i < 5 && !g.handResult; i++) g = applyMove(g, chooseMove(g, g.turn));
    return g;
  }, []);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ids = [900, 1800, 2800, 6500].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => ids.forEach(clearTimeout);
  }, []);
  const pv = publicState(base);
  const events = [...pv.events];
  if (step >= 1) events.push({ kind: 'play', seat: 1, tile: [2, 5], side: 'R' });
  if (step >= 2) events.push({ kind: 'pass', seat: 2 });
  if (step >= 3) events.push({ kind: 'pass', seat: 3 }, { kind: 'pass', seat: 0 }, { kind: 'paseCorrido', seat: 1, points: 25 });
  let view = { ...pv, events };
  if (step >= 4) {
    const winnerSeat = end === 'lose' ? 1 : 0;
    view = {
      ...view,
      events: [...events, { kind: 'play', seat: winnerSeat, tile: [3, 4], side: 'L' }],
      handResult: {
        kind: 'domino', winnerSeat, side: winnerSeat % 2, points: 42, capicua: true, bonus: 25, total: 67,
        counts: [0, 12, 14, 16], hands: [[], base.hands[1], base.hands[2], base.hands[3]], tieToMano: false,
      },
      ...(end ? { winner: winnerSeat % 2, scores: winnerSeat === 0 ? [112, 40] : [40, 112] } : {}),
    };
  }
  return (
    <TableView view={view} myHand={base.hands[0]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']}
      onPlay={() => {}} onNextHand={() => {}} onExit={() => {}} chat={{}} onChat={() => {}}
      endActions={<button className="btn primary">Otra partida</button>} />
  );
}

/** A real opening: I lay the doble seis, the next player has no six → pase de salida (+30) after 1.2 s. */
function SalidaDemo() {
  const [before, after] = useMemo(() => {
    for (let i = 0; i < 5000; i++) {
      const g = newGame(Math.random, publicRules('2v2'));
      if (g.mano !== 0 || g.hands[1].some((t) => t[0] === 6 || t[1] === 6)) continue;
      const b = applyMove(g, legalMoves(g, 0)[0]);
      return [b, applyMove(b, { type: 'pass' })];
    }
    throw new Error('no deal found');
  }, []);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setStep(1), 1200);
    return () => clearTimeout(id);
  }, []);
  const g = step ? after : before;
  return (
    <TableView view={publicState(g)} myHand={g.hands[0]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']}
      onPlay={() => {}} onNextHand={() => {}} onExit={() => {}} chat={{}} onChat={() => {}} endActions={null} />
  );
}

const soundLabels: { id: Sfx; label: string; detail: string }[] = [
  { id: 'tile', label: 'Ficha', detail: 'Golpe sobre la mesa · 4 variantes' },
  { id: 'knock', label: 'Pase', detail: 'Dos golpes de nudillos · 3 variantes' },
  { id: 'draw', label: 'Robar ficha', detail: 'Deslizamiento y toque · 3 variantes' },
  { id: 'paseCorrido', label: 'Pase corrido', detail: 'Celebración corta' },
  { id: 'capicua', label: 'Capicúa', detail: 'Fichas y campanas' },
  { id: 'win', label: 'Victoria', detail: 'Final de partida' },
  { id: 'second', label: 'Segundo lugar', detail: 'Final de todos contra todos' },
  { id: 'lose', label: 'Derrota', detail: 'Final discreto' },
];

function Soundboard() {
  useEffect(() => { preloadSfx(); }, []);
  return <main style={{ minHeight: '100dvh', padding: '32px 20px', color: '#fff5df', background: 'radial-gradient(circle at 50% 0%, #246154, #122d2b 65%, #0c201e)' }}>
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <p style={{ color: '#e5ba6b', fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase' }}>Capicúa · audio</p>
      <h1 style={{ fontSize: 'clamp(32px, 7vw, 52px)', lineHeight: 1.05, margin: '12px 0' }}>Sonidos de la mesa</h1>
      <p style={{ opacity: 0.8, lineHeight: 1.5, marginBottom: 24 }}>Toca cada botón para escuchar el nuevo sonido. Las fichas, los pases y el robo cambian ligeramente cada vez.</p>
      <div style={{ display: 'grid', gap: 10 }}>
        {soundLabels.map(({ id, label, detail }) => <button key={id} type="button" onClick={() => playSfx(id)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '17px 20px', border: '1px solid #ffffff32', borderRadius: 16, background: '#ffffff12', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <span><strong style={{ display: 'block', fontSize: 19 }}>{label}</strong><small style={{ display: 'block', opacity: 0.7, marginTop: 4 }}>{detail}</small></span>
          <span aria-hidden="true" style={{ fontSize: 24 }}>▶</span>
        </button>)}
      </div>
      <a href="/preview.html?s=fx" style={{ display: 'inline-block', marginTop: 25, color: '#efc77d' }}>Verlos durante una partida →</a>
    </div>
  </main>;
}

function Screen({ s }: { s: string }) {
  const noop = () => {};
  if (s === 'fx-sounds') return <Soundboard />;
  if (s === 'board-motion') return <BoardDesignPreview auto />;
  if (s === 'board-design') return <BoardDesignPreview />;
  if (s.startsWith('arcade')) return <ArcadePreview s={s} />;
  if (s.startsWith('main')) {
    // main | main-guest | main-out (signed out) | main-offline (no Supabase) | main-<tab>
    const signedOut = s === 'main-out' || s === 'main-offline';
    const tab = (['tables', 'profile', 'friends', 'ranking'].find((x) => s.endsWith(x)) ?? 'home') as 'home';
    return <MainScreen profile={signedOut ? null : profile} guest={s === 'main-guest'} online={s !== 'main-offline'} tab={tab}
      onTab={noop} onPractice={noop} onSignIn={noop} onQueue={noop} onRoom={noop} onCustom={noop} />;
  }
  if (s === 'chests') {
    const soon = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    return (
      <div className="game-shell"><main className="game-body" style={{ display: 'flex', alignItems: 'flex-end' }}>
        <div style={{ width: '100%' }}>
          <ChestSlots enabled onNeedAccount={noop} onChanged={noop} chests={[
            { id: 'a', slot: 0, kind: 'gold', unlock_at: soon(-1), game_id: null },
            { id: 'b', slot: 1, kind: 'silver', unlock_at: soon(95), game_id: null },
            { id: 'c', slot: 2, kind: 'diamond', unlock_at: null, game_id: null },
          ]} />
        </div>
      </main></div>
    );
  }
  if (s === 'tournament-invite') {
    return (
      <div className="screen tour-screen">
        <TournamentInvite busy={false} onJoin={noop} peek={{
          id: 't2', code: 'PAREJ', name: 'Parejas del viernes', mode: '2v2', size: 4, buyIn: 1000, phase: 'lobby', target: 150,
          host: 'Yokasta', pot: 5000, member: false,
          entries: [
            { id: 'e1', names: ['Yokasta', 'Robert'], open: false },
            { id: 'e2', names: ['Kirsy'], open: true },
            { id: 'e3', names: ['Chelo', 'Papo'], open: false },
          ],
        }} />
      </div>
    );
  }
  if (s.startsWith('tournament-')) {
    // tournament-lobby | tournament-bracket | tournament-final
    const phase = s === 'tournament-lobby' ? 'lobby' : s === 'tournament-final' ? 'finished' : 'playing';
    const names = { me: 'Wilfri', y: 'Yokasta', r: 'Robert', k: 'Kirsy', c: 'Chelo' } as Record<string, string>;
    const entries: EntryRow[] = ['me', 'y', 'r', 'k', 'c'].map((p, i) => ({
      id: `e${i}`, player1: p, player2: null,
      eliminated_round: phase === 'finished' ? [null, 3, 2, 2, 1][i] : phase === 'playing' ? [null, 1, null, null, null][i] : null,
      placement: phase === 'finished' ? [1, 2, 3, 3, 5][i] : phase === 'playing' ? [null, 5, null, null, null][i] : null,
    }));
    const soon = new Date(Date.now() + 83_000).toISOString();
    const done = (id: string, round: number, slot: number, a: string, b: string | null, winner: string, result: MatchRow['result'] = 'played'): MatchRow =>
      ({ id, round, slot, entry_a: a, entry_b: b, room_id: null, winner, status: 'done', result, ready_by: null });
    const matches: MatchRow[] = phase === 'lobby' ? [] : [
      done('m1', 1, 0, 'e0', 'e1', 'e0'),
      done('m2', 1, 1, 'e2', null, 'e2', 'bye'),
      done('m3', 1, 2, 'e3', null, 'e3', 'bye'),
      done('m4', 1, 3, 'e4', null, 'e4', 'bye'),
      ...(phase === 'finished' ? [
        done('m5', 2, 0, 'e0', 'e2', 'e0'),
        done('m6', 2, 1, 'e3', 'e4', 'e4', 'forfeit'),
        done('m7', 3, 0, 'e0', 'e4', 'e0'),
      ] : [
        { id: 'm5', round: 2, slot: 0, entry_a: 'e0', entry_b: 'e2', room_id: 'r1', winner: null, status: 'ready', result: null, ready_by: soon } as MatchRow,
        { id: 'm6', round: 2, slot: 1, entry_a: 'e3', entry_b: 'e4', room_id: 'r2', winner: null, status: 'playing', result: null, ready_by: null } as MatchRow,
        { id: 'm7', round: 3, slot: 0, entry_a: null, entry_b: null, room_id: null, winner: null, status: 'waiting', result: null, ready_by: null } as MatchRow,
      ]),
    ];
    const tour: TournamentRow = {
      id: 't1', code: 'KXQTB', name: 'Copa del barrio', host: 'me', mode: '1v1', size: 8, buy_in: 500, rules: publicRules('1v1'),
      turn_seconds: 25, phase, rounds: phase === 'lobby' ? null : 3, pot: 2500, champion: phase === 'finished' ? 'e0' : null,
    };
    return (
      <div className="screen tour-screen">
        <TournamentView tour={tour} entries={phase === 'lobby' ? entries.slice(0, 4) : entries} matches={matches} names={names} uid="me"
          onStart={noop} onCancel={noop} onLeave={noop} onKick={noop} onPlay={noop} />
      </div>
    );
  }
  if (s.startsWith('install-')) {
    // install-prompt (Android/Chrome) | install-ios | install-ios-inapp
    const kind = s.slice('install-'.length) as InstallKind;
    return (
      <>
        <MainScreen profile={null} guest={false} online tab="home" onTab={noop} onPractice={noop} onSignIn={noop} />
        <InstallSheet install={{ kind, available: true, nudge: true, install: async () => false }} onClose={noop} />
      </>
    );
  }
  if (s === 'reveal') return <ChestReveal reward={{ kind: 'gold', chips: 850, xp: 60 }} onClose={noop} />;
  if (s === 'shop') return <div className="game-shell"><main className="game-body"><ShopTab profile={profile} guest={false} onLinkGoogle={noop} /></main></div>;
  if (s.startsWith('gameover')) {
    let g = newGame(Math.random, publicRules('2v2')) as GameState;
    g = { ...g, scores: s === 'gameover-won' ? [104, 57] : [61, 112], winner: s === 'gameover-won' ? 0 : 1, handNo: 6,
      tally: { capicuas: [2, 1], tranques: [1, 0], hands: s === 'gameover-won' ? [4, 2] : [2, 4] },
      handResult: { kind: 'domino', winnerSeat: 0, side: 0, points: 31, capicua: true, bonus: 25, total: 56, counts: [0, 12, 9, 10], hands: [[], [], [], []], tieToMano: false } };
    return (
      <TableView view={publicState(g)} myHand={[]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']} onPlay={noop} onNextHand={noop} onExit={noop}
        chat={{}} onChat={noop} showXp
        resultNote={<><div className="reward chips up"><span>🪙</span><b>+1,000</b></div>
          <div className="reward chest"><ChestArtPreview /><b>Cofre de plata</b></div></>}
        endActions={<><button className="btn primary">Jugar otra</button><button className="btn ghost">Salir</button></>} />
    );
  }
  if (s === 'big-hand') {
    // 1v1 after drawing a lot: 15 tiles have to fit a phone without scrolling sideways.
    const g = newGame(Math.random, publicRules('1v1'));
    const hand = fullSet().slice(13);
    return (
      <TableView view={{ ...publicState(g), turn: 0 }} myHand={hand} mySeat={0} names={['', 'Yokasta']} onPlay={noop} onNextHand={noop} onExit={noop}
        chat={{}} onChat={noop} avatars={[profile.avatar_url, face('#c0487a')]} speaking={new Set([1 as Seat])}
        voice={<VoiceButton voice={fakeVoice({ status: 'on', micOn: true })} me="me" />} endActions={null} />
    );
  }
  if (s === 'voice') {
    // Every state of the voice button, then a 2v2 table with Yokasta talking.
    const states: [string, Voice][] = [
      ['off, 2 on voice', fakeVoice({ status: 'off' })],
      ['connecting', fakeVoice({ status: 'connecting' })],
      ['live', fakeVoice({ status: 'on', micOn: true })],
      ['live + talking', fakeVoice({ status: 'on', micOn: true, speaking: new Set(['me']) })],
      ['muted', fakeVoice({ status: 'on', micOn: false })],
      ['mic blocked', fakeVoice({ status: 'on', micBlocked: true })],
      ['needs tap', fakeVoice({ status: 'on', needsTap: true })],
      ['error', fakeVoice({ status: 'error' })],
    ];
    return (
      <div className="screen" style={{ gap: 10 }}>
        {states.map(([label, v], i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <small className="fine" style={{ width: 110, textAlign: 'left' }}>{label}</small>
            <VoiceButton voice={v} me="me" others={i === 0 ? 2 : 0} />
          </div>
        ))}
      </div>
    );
  }
  if (s === 'friends' || s === 'friends-invite') {
    // Mesas tab's friend card; friends-invite adds Yokasta's invite on top.
    return (
      <SocialContext.Provider value={fakeSocial(s === 'friends-invite' ? { invites: [sampleInvite] } : {})}>
        <div className="game-shell"><main className="game-body"><div className="tab-page">
          <FriendsSection profile={profile} onQuickInvite={noop} onWatch={noop} push={fakePush('off')} />
        </div></main></div>
        <InviteToast onRoom={noop} onTournament={noop} />
      </SocialContext.Provider>
    );
  }
  if (s === 'invite-sheet') {
    return <SocialContext.Provider value={fakeSocial()}><InviteFriendsSheet target={{ roomId: 'r1' }} onClose={noop} /></SocialContext.Provider>;
  }
  if (s === 'quick-invite') {
    return <SocialContext.Provider value={fakeSocial()}><QuickInviteSheet friend={sampleFriends[1]} onClose={noop} onRoom={noop} onCustom={noop} /></SocialContext.Provider>;
  }
  if (s === 'looks') {
    return <PreviewLook><div className="game-shell"><main className="game-body"><div className="tab-page"><LookPicker /></div></main></div></PreviewLook>;
  }
  if (s.startsWith('table-look')) {
    // table-look-<felt>-<tiles>, e.g. table-look-vino-latino
    const [, , felt = 'vino', tiles = 'latino'] = s.split('-').slice(0);
    let g = newGame(Math.random, publicRules('2v2'));
    for (let i = 0; i < 9 && !g.handResult; i++) g = applyMove(g, chooseMove(g, g.turn));
    return (
      <PreviewLook felt={felt} tiles={tiles}>
        <TableView view={publicState(g)} myHand={g.hands[0]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']} onPlay={noop} onNextHand={noop} onExit={noop}
          chat={{}} onChat={noop} endActions={null} />
      </PreviewLook>
    );
  }
  if (s === 'photo' || s === 'photo-none') {
    const p = { ...profile, avatar_url: s === 'photo' ? profile.avatar_url : null };
    return <div className="game-shell"><main className="game-body"><div className="tab-page profile-page"><PhotoPicker profile={p} level={7} /><h2 className="tab-title">{p.display_name}</h2></div></main></div>;
  }
  if (s === 'queue') return <QueueScreen stake={1000} mode="2v2" onMatched={noop} onCancel={noop} />;
  if (s === 'custom-form') return <CustomForm profile={profile} onBack={noop} onCreated={noop} />;
  if (s === 'profile') {
    return <ProfileCard stats={{ id: 'x', display_name: 'Yokasta', xp: 6_200, games: 214, wins: 131, capicuas: 58, pollonas: 7, biggest_pot: 12_000, tournaments_won: 2, avatar_url: face('#c0487a') }} onClose={noop} />;
  }
  if (s === 'ready') {
    const r = data({
      room: room({ phase: 'ready', phase_ends_at: inFuture(17), mode: '1v1', rules: publicRules('1v1') }),
      seats: [seat(0, 'Wilfri', 4), seat(1, 'Yokasta', 13, { ready: true })],
      bets: [{ kind: 'cap1', amount: 250, multiplier: 2.7, status: 'open', payout: 0, game_id: null }],
    });
    return <Pregame r={r} uid="me" profile={profile} voice={null} onLeave={noop} />;
  }
  if (s === 'custom-guest') {
    // Someone else's full 2v2 table: the switch button explains the other team is full.
    const r = data({
      room: room({ kind: 'custom', phase: 'lobby', phase_ends_at: null, host: 'u-Robert', stake: 0, turn_seconds: 25,
        rules: { mode: '2v2', target: 100, capicuaBonus: 25, paseCorridoBonus: 25 } }),
      seats: [seat(0, 'Robert', 6, { ready: true }), seat(1, 'Wilfri', 4), seat(2, 'Kirsy', 2, { ready: true }), seat(3, 'Yokasta', 13)],
    });
    return <Pregame r={r} uid="me" profile={profile} voice={null} onLeave={noop} />;
  }
  if (s.startsWith('board-')) {
    // board-<mode>-<moves>[-t<turn seat>], e.g. board-2v2-24, board-ffa-18-t3: a game N moves in.
    const [, m = '2v2', moves = '16', turn] = s.split('-');
    const mode = m as '1v1' | '2v2' | 'ffa';
    let g = newGame(() => 0.37, publicRules(mode));
    for (let i = 0; i < Number(moves) && !g.handResult; i++) g = applyMove(g, forcedMove(g, g.turn) ?? chooseMove(g, g.turn, () => 0.5));
    const view = publicState(g);
    if (turn) view.turn = Number(turn.slice(1)) as Seat;
    const names = mode === '1v1' ? ['', 'Yokasta'] : ['', 'Yokasta', 'Robert', 'Kirsy'];
    return (
      <TableView view={view} myHand={g.hands[0]} mySeat={0} names={names} onPlay={noop} onNextHand={noop} onExit={noop}
        chat={{}} onChat={noop} endActions={null} turnDeadline={Date.now() + 12_000}
        avatars={mode === '1v1' ? [profile.avatar_url, face('#c0487a')] : [profile.avatar_url, face('#c0487a'), null, face('#2d8a5f')]} />
    );
  }
  if (s === 'markers') {
    // Close-up of every ownership marker on the busiest tiles, in three domino styles.
    const roles = ['me', 'partner', 'top', 'left', 'right'] as const;
    const styles = ['marfil', 'noche', 'latino'];
    return (
      <div style={{ padding: 12, display: 'grid', gap: 12 }}>
        {styles.map((st) => (
          <PreviewLook key={st} tiles={st}>
            <div className="mode-2v2" style={{ ...lookVars(feltById('verde'), tilesById(st)), background: '#0b4934', borderRadius: 12, padding: 8, height: 'auto', minHeight: 0 }}>
              <svg viewBox="-0.2 -0.2 16.4 2.4" style={{ width: '100%', display: 'block' }}>
                {roles.map((r, i) => (
                  <g key={r}>
                    <TileShape x={i * 3.2} y={0.5} vertical={false} first={6} second={5} owner={r} ownerName={r} className="placed" />
                    <TileShape x={i * 3.2 + 2.1} y={0} vertical first={6} second={6} owner={r} className="placed" />
                  </g>
                ))}
              </svg>
            </div>
          </PreviewLook>
        ))}
      </div>
    );
  }
  if (s === 'missions') return <MissionsSheet m={fakeMissions()} onClose={noop} />;
  if (s === 'home-missions') {
    return (
      <div className="game-shell"><main className="game-body tab-home">
        <HomeTab profile={profile} guest={false} online dailyReady activeRoom={null} onResume={noop} onDaily={noop} onAvatar={noop}
          onMode={noop} chests={null} missions={{ done: 2, total: 3, claimable: 1, onOpen: noop }} />
      </main></div>
    );
  }
  if (s === 'settings-push') {
    return <SettingsSheet onClose={noop} extra={<><PushRow push={fakePush('off')} /><PushRow push={fakePush('install')} /></>} />;
  }
  if (s === 'watch' || s === 'watched') {
    // watch: I'm watching Robert (seat 2). watched: I'm playing and two friends are watching.
    let g = newGame(() => 0.37, publicRules('2v2'));
    for (let i = 0; i < 14 && !g.handResult; i++) g = applyMove(g, forcedMove(g, g.turn) ?? chooseMove(g, g.turn, () => 0.5));
    const view = { ...publicState(g), turn: 2 as Seat };
    return s === 'watch' ? (
      <TableView view={view} myHand={[]} mySeat={2} names={['Wilfri', 'Yokasta', 'Robert', 'Kirsy']} onPlay={noop} onNextHand={noop} onExit={noop}
        chat={{}} onChat={noop} endActions={null} turnDeadline={Date.now() + 9000} watching={{ name: 'Robert', onLeave: noop }} />
    ) : (
      <TableView view={view} myHand={g.hands[0]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']} onPlay={noop} onNextHand={noop} onExit={noop}
        chat={{}} onChat={noop} endActions={null} watchers={['Papo', 'Chelo']} />
    );
  }
  if (s === 'one-move') {
    // My turn with exactly one legal tile; the server never answers (onPlay only counts), so a
    // tap followed by autoplay must still send just one move.
    let g = newGame(Math.random, publicRules('1v1'));
    for (let i = 0; i < 60; i++) {
      if (g.handResult) g = newGame(Math.random, publicRules('1v1'));
      const moves = legalMoves(g, g.turn);
      if (g.turn === 0 && moves.length === 1 && g.line.length > 0) break;
      g = applyMove(g, forcedMove(g, g.turn) ?? chooseMove(g, g.turn));
    }
    const w = window as unknown as { __plays: number };
    w.__plays = 0;
    return (
      <TableView view={publicState(g)} myHand={g.hands[0]} mySeat={0} names={['', 'Yokasta']}
        onPlay={() => { w.__plays++; }} onNextHand={noop} onExit={noop} chat={{}} onChat={noop} endActions={null} />
    );
  }
  if (s === 'notice') {
    let g = newGame(Math.random, publicRules('2v2'));
    for (let i = 0; i < 6 && !g.handResult; i++) g = applyMove(g, chooseMove(g, g.turn));
    return (
      <TableView view={{ ...publicState(g), turn: 1 }} myHand={g.hands[0]} mySeat={0} names={['', 'Yokasta', 'Robert', 'Kirsy']}
        onPlay={noop} onNextHand={noop} onExit={noop} chat={{}} onChat={noop} endActions={null} notice="No es tu turno." />
    );
  }
  if (s === 'custom') {
    const r = data({
      room: room({ kind: 'custom', phase: 'lobby', phase_ends_at: null, host: 'me', stake: 750, turn_seconds: 25,
        rules: { mode: '2v2', target: 200, capicuaBonus: 25, paseCorridoBonus: 0 } }),
      seats: [seat(0, 'Wilfri', 4, { ready: true }), seat(1, 'Robert', 6, { ready: true }), seat(3, 'Kirsy', 2)],
    });
    return <Pregame r={r} uid="me" profile={profile} voice={null} onLeave={noop} />;
  }
  if (s === 'fx' || s === 'fx-win' || s === 'fx-lose') return <FxDemo end={s === 'fx' ? null : s === 'fx-win' ? 'win' : 'lose'} />;
  if (s === 'fx-salida') return <SalidaDemo />;
  if (s === 'report') {
    const who = { id: 'u-Robert', display_name: 'Robert', xp: 1_100, games: 88, wins: 41, capicuas: 12, pollonas: 1, biggest_pot: 3_000, tournaments_won: 0, avatar_url: null };
    return (
      <ProfileCard stats={who} onClose={noop} actions={(
        <>
          <button className="btn ghost wide">{strings('es').fair.mute}</button>
          <ReportButton userId={who.id} gameId="g1" name={who.display_name} />
        </>
      )} />
    );
  }
  if (s === 'fair-alerts' || s === 'fair-back') {
    let g = newGame(Math.random, publicRules('2v2'));
    for (let i = 0; i < 9 && !g.handResult; i++) g = applyMove(g, chooseMove(g, g.turn));
    const alert = (user: string, seatNo: number, kind: TableAlert['kind'], seconds: number | null = null): TableAlert =>
      ({ id: seatNo + 10, user_id: user, seat: seatNo, kind, seconds, at: Date.now() });
    const left = alert('u-Yokasta', 1, 'left');
    const r = data({
      room: room({ phase: 'playing', current_game: 'g1' }),
      seats: [seat(0, 'Wilfri', 4), seat(1, 'Yokasta', 13), seat(2, 'Robert', 6), seat(3, 'Kirsy', 5)],
      online: new Set(['me', 'u-Yokasta', 'u-Robert', 'u-Kirsy']),
      game: { id: 'g1', public_state: publicState(g), version: 3, stake: 1000, pot: 4000, turn_ms: 15000, auto_delay_ms: 15000, settled: false },
      hand: g.hands[0],
      receivedAt: Date.now() - 4000,
      alerts: { 'u-Yokasta': left },
      lastAlert: s === 'fair-back' ? alert('me', 0, 'back', 12) : alert('u-Robert', 2, 'screenshot'),
    });
    return <OnlineTable r={r} uid="me" voice={null} onLeave={noop} onPlayAnother={noop} />;
  }
  if (s === 'table' || s === 'away') {
    let g = newGame(Math.random, publicRules('2v2'));
    for (let i = 0; i < 11 && !g.handResult; i++) g = applyMove(g, chooseMove(g, g.turn));
    const r = data({
      room: room({ phase: 'playing', current_game: 'g1' }),
      seats: [seat(0, 'Wilfri', 4, { away: s === 'away' }), seat(1, 'Yokasta', 13), seat(2, 'Robert', 6, { away: s === 'away' }), seat(3, 'Kirsy', 5)],
      online: new Set(['me', 'u-Yokasta', 'u-Kirsy']),
      game: { id: 'g1', public_state: publicState(g), version: 3, stake: 1000, pot: 3000, turn_ms: 15000, auto_delay_ms: 15000, settled: false },
      hand: g.hands[0],
      receivedAt: Date.now() - 7000,
    });
    return <OnlineTable r={r} uid="me" voice={null} onLeave={noop} onPlayAnother={noop} />;
  }
  // default: countdown lobby, 2v2 public
  const r = data({
    seats: [seat(0, 'Wilfri', 4), seat(1, 'Yokasta', 6), seat(2, 'Robert', 5), seat(3, 'Chelo', 5, { is_bot: true, user_id: null })],
  });
  return <Pregame r={r} uid="me" profile={profile} voice={null} onLeave={noop} />;
}

import { ChestArt } from '../ui/Chests';
const ChestArtPreview = () => <ChestArt kind="silver" className="bounce-in" />;

/**
 * Layout check for the table screen, run from the browser console / automation:
 * nothing may cover the domino chain or step into the board area, and nothing may scroll sideways.
 */
(window as unknown as { __tableCheck: () => unknown }).__tableCheck = () => {
  const R = (e: Element) => e.getBoundingClientRect();
  const hit = (a: DOMRect, b: { left: number; right: number; top: number; bottom: number }) =>
    a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const board = R(document.querySelector('.board-wrap')!);
  const tiles = [...document.querySelectorAll('.board .placed')].map(R);
  const chain = tiles.length
    ? { left: Math.min(...tiles.map((t) => t.left)), top: Math.min(...tiles.map((t) => t.top)), right: Math.max(...tiles.map((t) => t.right)), bottom: Math.max(...tiles.map((t) => t.bottom)) }
    : null;
  const others: [string, DOMRect][] = [
    ...[...document.querySelectorAll('.seat')].map((e) => [`seat-${e.className.match(/seat-(top|left|right)/)?.[1]}`, R(e)] as [string, DOMRect]),
    ['self-seat', R(document.querySelector('.self-seat')!)],
    ...[...document.querySelectorAll('.bubble, .self-bubble, .turn-arrow, .toast')].map((e) => [e.classList[0], R(e)] as [string, DOMRect]),
  ];
  const screen = document.querySelector('.table-screen')!;
  return {
    size: `${innerWidth}x${innerHeight}`,
    sideScroll: document.documentElement.scrollWidth > innerWidth || screen.scrollWidth > screen.clientWidth,
    board: `${Math.round(board.width)}x${Math.round(board.height)}`,
    tilePx: tiles.length ? Math.round(Math.min(...tiles.map((t) => Math.min(t.width, t.height)))) : null,
    chainInsideBoard: !chain || (chain.left >= board.left - 1 && chain.right <= board.right + 1 && chain.top >= board.top - 1 && chain.bottom <= board.bottom + 1),
    coversChain: others.filter(([, r]) => chain && hit(r, chain)).map(([n]) => n),
    inBoardArea: others.filter(([, r]) => hit(r, board)).map(([n]) => n),
    arrowBeside: [...document.querySelectorAll('.turn-arrow')].map((a) => a.closest('.seat, .self-seat')?.className.match(/seat-(top|left|right)|self-seat/)?.[0]),
  };
};

function App() {
  const [lang, setLang] = useState<Lang>('es');
  const s = new URLSearchParams(location.search).get('s') ?? 'countdown';
  return (
    <LangContext.Provider value={{ lang, t: strings(lang), setLang }}>
      <Screen s={s} />
    </LangContext.Provider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode><App /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());

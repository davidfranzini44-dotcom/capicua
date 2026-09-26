// Dev-only screen gallery: /preview.html?s=main|main-guest|main-out|main-offline|main-profile|queue|ready|countdown|custom|profile|table|away|big-hand|voice|photo|photo-none|install-prompt|install-ios|install-ios-inapp
// Renders the online screens with sample data so layouts can be checked without a backend.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMove, fullSet, newGame, type Seat } from '../../supabase/functions/_shared/domino.ts';
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

/** A stand-in profile photo (a coloured face) so avatar layouts can be checked offline. */
const face = (bg: string) => `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="26" r="12" fill="#f3d2b3"/><path d="M10 64c2-14 12-20 22-20s20 6 22 20z" fill="#f3d2b3"/></svg>`)}`;
const profile: Profile = { id: 'me', display_name: 'Wilfri', chips: 18_450, xp: 1_380, last_daily: null, last_rescue: null, avatar_url: face('#3b7dd8') };
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
    room: room({}), seats: [], game: null, hand: [], bets: [], chat: {}, gone: false, online: new Set<string>(), receivedAt: Date.now(),
    sendChat: () => {}, reload: async () => {}, ...over,
  } as RoomData;
}

function Screen({ s }: { s: string }) {
  const noop = () => {};
  if (s === 'board-design') return <BoardDesignPreview />;
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
  if (s === 'custom') {
    const r = data({
      room: room({ kind: 'custom', phase: 'lobby', phase_ends_at: null, host: 'me', stake: 750, turn_seconds: 25,
        rules: { mode: '2v2', target: 200, capicuaBonus: 25, paseCorridoBonus: 0 } }),
      seats: [seat(0, 'Wilfri', 4, { ready: true }), seat(1, 'Robert', 6, { ready: true }), seat(3, 'Kirsy', 2)],
    });
    return <Pregame r={r} uid="me" profile={profile} voice={null} onLeave={noop} />;
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

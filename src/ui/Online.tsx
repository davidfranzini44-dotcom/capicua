import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Mode, Ruleset } from '../../supabase/functions/_shared/domino.ts';
import { BONUS_POINTS, botsAllowed, CHIPS, levelFromXp, MODES, REGLAS, TURN_SECONDS, xpForLevel, type CustomSettings } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { forgetTable, lastTable } from '../lib/lastTable';
import { api, ApiError, authReturnUrl, canClaimDaily, needsName, onlineEnabled, reloadProfile, supabase, useProfile, useSession, type Profile } from '../lib/supabase';
import { fitName, NAME_MAX, nextRename, RENAME_DAYS } from '../lib/names';
import { NameEditor } from './NameEditor';
import { usePlayerStats } from '../lib/useRoom';
import { setAvatar, uploadAvatar } from '../lib/avatar';
import { Avatar, ChipBalance, LevelBadge, useErrorText } from './common';
import { useChests } from '../lib/useChests';
import { ChestSlots } from './Chests';
import { useInstall } from '../lib/install';
import { ArcadeSheet, GameShell, HomeTab, InstallSheet, ModeSheet, SettingsSheet, Sheet, TopBar, type Tab } from './MainScreen';
import { PracticeTable } from './PracticeTable';
import { ShopTab } from './Shop';
import { FeaturedTournaments, TournamentForm, TournamentScreen, TournamentsSection } from './Tournament';
import { TournamentHistoryList } from './Trophies';
import { useTournamentHistory } from '../lib/useTournament';
import { FriendsSection, InviteToast, joinInvitedRoom, LastSeenRow, PushRow, QuickInviteSheet } from './Friends';
import { usePresenceHeartbeat } from '../lib/presence';
import { SpectatorsHearRow } from './Spectators';
import { MissionsSheet } from './Missions';
import { useMissions } from '../lib/missions';
import { pushNeedsPrompt, usePush } from '../lib/push';
import { PushPromptSheet } from './PushPrompt';
import { LookPicker } from './LookPicker';
import { ProfileCard } from './ProfileCard';
import { LookContext, useLookState } from '../lib/look';
import { SocialContext, useSocial, useSocialState, type Friend } from '../lib/social';
import type { Invite } from '../lib/social';
import { InboxSheet, useInboxSummary } from './Inbox';
import { useDirectMessages } from '../lib/directMessages';

const AdminScreen = lazy(() => import('./Admin').then((m) => ({ default: m.AdminScreen })));

// The table screens pull in LiveKit (voice) — only load them when someone sits down.
const RoomScreen = lazy(() => import('./RoomScreen').then((m) => ({ default: m.RoomScreen })));
const WatchScreen = lazy(() => import('./Watch'));

/** Invite links look like …/?sala=ABCD */
export const inviteCodeFromUrl = () => new URLSearchParams(location.search).get('sala')?.toUpperCase() ?? null;

type View =
  | { kind: 'main'; tab: Tab; notice?: string; inbox?: true | string }
  | { kind: 'queue'; stake: number; mode: Mode; ruleset?: Ruleset; notice?: string }
  | { kind: 'room'; roomId: string }
  | { kind: 'custom'; inviteFriend?: string }
  | { kind: 'practice'; mode: Mode; ruleset?: Ruleset }
  | { kind: 'signin' }
  | { kind: 'admin' }
  /** `back`: where ← goes (Mesas unless it was opened from Inicio or the admin panel). */
  | { kind: 'tournament'; id?: string; code?: string; back?: 'home' | 'tables' | 'admin' }
  /** `official`: an admin making one for everyone. */
  | { kind: 'newTournament'; official?: boolean }
  | { kind: 'watch'; friendId: string; name: string }
  /** A match of one of my tournaments, from the bracket (back to it on leaving). */
  | { kind: 'watchMatch'; roomId: string; tournamentId: string };

const home: View = { kind: 'main', tab: 'home' };

/** Everything when online play is configured: main screen, sign-in, queue, custom tables, the table. */
export function Online() {
  const { session, loading } = useSession();
  const uid = session?.user.id;
  /** Anonymous sign-in: free tables only (the server enforces this too). */
  const guest = !!session?.user.is_anonymous;
  const profile = useProfile(uid);
  const [view, setView] = useState<View>(home);
  const [resolved, setResolved] = useState(false);
  const errText = useErrorText();
  const { t } = useI18n();
  const signedIn = !!session && !!profile && !needsName(profile);
  /** Friends see me as busy while I'm at a table. */
  const social = useSocialState(signedIn ? uid : undefined, view.kind === 'room' ? 'playing' : 'online');
  usePresenceHeartbeat(signedIn);
  const look = useLookState(signedIn ? profile : null, guest);

  /** Where does this player belong right now? Seated → table, queued → queue, else the main screen. */
  const resolve = useCallback(async (notice?: string) => {
    // Back from Stripe Checkout?
    const compra = new URLSearchParams(location.search).get('compra');
    if (compra) {
      history.replaceState(null, '', location.pathname);
      return setView({ kind: 'main', tab: 'shop', notice: compra === 'ok' ? t.shop.thanks : t.shop.cancelled });
    }
    // Tournament invite link: …/?torneo=ABCDE
    const torneo = new URLSearchParams(location.search).get('torneo');
    if (torneo) {
      history.replaceState(null, '', location.pathname);
      return setView({ kind: 'tournament', code: torneo.toUpperCase() });
    }
    // From a notification: an invite to accept, or the friends list.
    const params = new URLSearchParams(location.search);
    const invitation = params.get('invitacion');
    if (invitation) {
      history.replaceState(null, '', location.pathname);
      try {
        const { data: inv } = await supabase.from('table_invites').select('room_id').eq('id', invitation).eq('status', 'sent').maybeSingle();
        if (inv?.room_id) {
          // A table: sit down first (moving from a lobby is automatic), then mark it accepted.
          const j = await joinInvitedRoom(inv.room_id);
          if (j !== 'in_game') {
            api('invite_respond', { inviteId: invitation, accept: true }).catch(() => {});
            return setView({ kind: 'room', roomId: j.roomId });
          }
          // Mid-game: back to it. The invite stays up on screen and warns before leaving the game.
        } else {
          const r = await api<{ roomId: string | null; tournamentId: string | null }>('invite_respond', { inviteId: invitation, accept: true });
          if (r.tournamentId) return setView({ kind: 'tournament', id: r.tournamentId });
          if (r.roomId) {
            const j = await joinInvitedRoom(r.roomId);
            if (j !== 'in_game') return setView({ kind: 'room', roomId: j.roomId });
          }
        }
      } catch (e) {
        return setView({ kind: 'main', tab: 'home', notice: errText(e) });
      }
    }
    if (params.get('tab') === 'tables') {
      history.replaceState(null, '', location.pathname);
      return setView({ kind: 'main', tab: 'tables' });
    }
    if (params.get('tab') === 'inbox') {
      const chat = params.get('chat');
      history.replaceState(null, '', location.pathname);
      return setView({ kind: 'main', tab: 'home', inbox: chat || true });
    }
    const code = inviteCodeFromUrl();
    if (code) {
      history.replaceState(null, '', location.pathname);
      try {
        // Waiting at another table (not playing) just moves you; a game in progress has to be forfeited first.
        const r = await api<{ roomId: string }>('join_room', { code, switchTable: 'lobby' });
        return setView({ kind: 'room', roomId: r.roomId });
      } catch (e) {
        return setView({ kind: 'main', tab: 'home', notice: errText(e) });
      }
    }
    const s = await api<{ roomId?: string }>('queue_status').catch(() => ({}) as { roomId?: string });
    if (s.roomId) return setView({ kind: 'room', roomId: s.roomId });
    // The game you left open finished while you were away: show how it ended.
    const last = lastTable();
    if (last) {
      const { data: old } = await supabase.from('rooms').select('phase, current_game').eq('id', last).maybeSingle();
      if (old?.phase === 'finished' && old.current_game) return setView({ kind: 'room', roomId: last });
      forgetTable();
    }
    const { data: q } = await supabase.from('queue').select('stake, mode, ruleset').eq('user_id', uid!).maybeSingle();
    if (q) return setView({ kind: 'queue', stake: q.stake, mode: q.mode as Mode, ruleset: (q.ruleset ?? 'traditional') as Ruleset, notice });
    setView({ kind: 'main', tab: 'home', notice });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!uid || !profile || needsName(profile) || resolved) return;
    setResolved(true);
    resolve();
  }, [uid, profile, resolved, resolve]);
  useEffect(() => { if (!uid) setResolved(false); }, [uid]);

  const joinQueue = async (stake: number, mode: Mode, ruleset: Ruleset = 'traditional') => {
    try {
      const res = await api<{ roomId?: string }>('queue_join', { stake, mode, ruleset });
      setView(res.roomId ? { kind: 'room', roomId: res.roomId } : { kind: 'queue', stake, mode, ruleset });
    } catch (e) {
      setView({ kind: 'main', tab: 'home', notice: errText(e) });
    }
  };

  const screen = ((): ReactNode => {
    if (loading) return <Loading />;
    if (view.kind === 'practice') return <PracticeTable key={`${view.mode}${view.ruleset}`} mode={view.mode} ruleset={view.ruleset} onExit={() => setView(home)} />;

    if (!session) {
      if (view.kind === 'signin') return <SignIn onBack={() => setView(home)} />;
      return (
        <MainScreen
          profile={null} guest={false} online
          tab={view.kind === 'main' ? view.tab : 'home'}
          onTab={(tab) => setView({ kind: 'main', tab })}
          onPractice={(mode, ruleset) => setView({ kind: 'practice', mode, ruleset })}
          onSignIn={() => setView({ kind: 'signin' })}
        />
      );
    }
    if (!profile) return <Loading />;
    if (needsName(profile)) return <NamePrompt profile={profile} />;

    switch (view.kind) {
      case 'room':
        return (
          <Suspense fallback={<Loading />}>
            <RoomScreen
              key={view.roomId}
              roomId={view.roomId}
              uid={uid!}
              profile={profile}
              onLeave={() => setView(home)}
              onBrokeUp={() => resolve(t.tableBroke)}
              onRequeue={joinQueue}
              onTournament={(id) => setView({ kind: 'tournament', id })}
            />
          </Suspense>
        );
      case 'tournament':
        return (
          <TournamentScreen
            key={view.id ?? view.code}
            id={view.id} code={view.code} uid={uid!} profile={profile}
            onBack={() => setView(view.back === 'home' ? home : view.back === 'admin' ? { kind: 'admin' } : { kind: 'main', tab: 'tables' })}
            onRoom={(roomId) => setView({ kind: 'room', roomId })}
            onWatch={(roomId, tournamentId) => setView({ kind: 'watchMatch', roomId, tournamentId })}
          />
        );
      case 'newTournament':
        return (
          <TournamentForm
            profile={profile} guest={guest} official={view.official}
            onBack={() => setView(view.official ? { kind: 'admin' } : { kind: 'main', tab: 'tables' })}
            onCreated={(id) => setView({ kind: 'tournament', id, back: view.official ? 'admin' : 'tables' })}
          />
        );
      case 'watch':
      return (
        <Suspense fallback={<Loading />}>
          <WatchScreen key={view.friendId} friendId={view.friendId} friendName={view.name} uid={uid!} onExit={() => setView({ kind: 'main', tab: 'tables' })} />
        </Suspense>
      );
    case 'watchMatch':
      return (
        <Suspense fallback={<Loading />}>
          <WatchScreen key={view.roomId} roomId={view.roomId} uid={uid!} onExit={() => setView({ kind: 'tournament', id: view.tournamentId })} />
        </Suspense>
      );
    case 'queue':
        return <QueueScreen {...view} onMatched={(roomId) => setView({ kind: 'room', roomId })} onCancel={() => setView(home)}
          onPractice={(mode, ruleset) => setView({ kind: 'practice', mode, ruleset })} onCustom={() => setView({ kind: 'custom' })} />;
      case 'admin':
        return (
          <Suspense fallback={<Loading />}>
            <AdminScreen onExit={() => setView(home)} onTournament={(id) => setView({ kind: 'tournament', id, back: 'admin' })}
              onNewTournament={() => setView({ kind: 'newTournament', official: true })} />
          </Suspense>
        );
      case 'custom':
        return (
          <CustomForm profile={profile} guest={guest} onBack={() => setView({ kind: 'main', tab: 'tables' })} onCreated={async (roomId) => {
            if (view.inviteFriend) await social?.invite(view.inviteFriend, { roomId }).catch(() => {});
            setView({ kind: 'room', roomId });
          }} />
        );
      default:
        return (
          <MainScreen
            key={view.kind === 'main' ? view.notice ?? '' : ''}
            profile={profile} guest={guest} online
            tab={view.kind === 'main' ? view.tab : 'home'}
            notice={view.kind === 'main' ? view.notice : undefined}
            openInbox={view.kind === 'main' ? view.inbox : undefined}
            onTab={(tab) => setView({ kind: 'main', tab })}
            onPractice={(mode, ruleset) => setView({ kind: 'practice', mode, ruleset })}
            onQueue={joinQueue}
            onRoom={(roomId) => setView({ kind: 'room', roomId })}
            onCustom={(inviteFriend) => setView({ kind: 'custom', inviteFriend })}
            onAdmin={() => setView({ kind: 'admin' })}
            onTournament={(id, back) => setView({ kind: 'tournament', id, back })}
            onTournamentCode={(code) => setView({ kind: 'tournament', code })}
            onWatch={(f) => setView({ kind: 'watch', friendId: f.id, name: f.name })}
            onNewTournament={() => setView({ kind: 'newTournament' })}
          />
        );
    }
  })();

  return (
    <LookContext.Provider value={look}>
      <SocialContext.Provider value={social}>
        {screen}
        {/* Everywhere, a table included: accepting from a game in progress warns before forfeiting it. */}
        <InviteToast onRoom={(roomId) => setView({ kind: 'room', roomId })} onTournament={(id) => setView({ kind: 'tournament', id })} />
      </SocialContext.Provider>
    </LookContext.Provider>
  );
}

/** Online play not configured yet: the same main screen, practice only. */
export function OfflineApp() {
  const [view, setView] = useState<{ tab: Tab } | { practice: Mode; ruleset?: Ruleset }>({ tab: 'home' });
  if ('practice' in view) return <PracticeTable key={`${view.practice}${view.ruleset}`} mode={view.practice} ruleset={view.ruleset} onExit={() => setView({ tab: 'home' })} />;
  return (
    <MainScreen
      profile={null} guest={false} online={false}
      tab={view.tab}
      onTab={(tab) => setView({ tab })}
      onPractice={(mode, ruleset) => setView({ practice: mode, ruleset })}
    />
  );
}

const Loading = () => {
  const { t } = useI18n();
  return <div className="screen center"><p>{t.loading}</p></div>;
};

// ---------- main screen, wired ----------

interface MainProps {
  profile: Profile | null;
  guest: boolean;
  online: boolean;
  tab: Tab;
  notice?: string;
  openInbox?: true | string;
  onTab: (t: Tab) => void;
  onPractice: (mode: Mode, ruleset?: Ruleset) => void;
  onSignIn?: () => void;
  onQueue?: (stake: number, mode: Mode, ruleset?: Ruleset) => void;
  onRoom?: (roomId: string) => void;
  onCustom?: (inviteFriend?: string) => void;
  onAdmin?: () => void;
  onTournament?: (id: string, back?: 'home' | 'tables') => void;
  onTournamentCode?: (code: string) => void;
  onNewTournament?: () => void;
  onWatch?: (friend: Friend) => void;
}

type SheetState = null | 'settings' | 'coins' | 'code' | 'install' | 'push' | 'missions' | 'arcade' | 'inbox' | { mode: Mode };

/** How long someone looks at the home screen before we suggest installing. */
const INSTALL_NUDGE_MS = 8000;
/** …and before we ask for notifications (every time the app opens, until they're on). */
const PUSH_PROMPT_MS = 1500;
/** Asked already since the app opened: "Ahora no" lasts until the next time it's opened. */
let pushPromptShown = false;
/** An installed app is rarely closed: coming back after this long counts as opening it again. */
const REOPEN_MS = 30 * 60_000;

export function MainScreen(p: MainProps) {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [error, setError] = useState<string | null>(p.notice ?? null);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [quickInvite, setQuickInvite] = useState<Friend | null>(null);
  const social = useSocial();
  const signedIn = !!p.profile;
  const { chests, reload: reloadChests } = useChests(signedIn && !p.guest ? p.profile!.id : undefined);
  const missions = useMissions(signedIn && p.online);
  const messages = useDirectMessages(signedIn ? p.profile!.id : undefined);
  const dailyReady = signedIn && !p.guest && canClaimDaily(p.profile);
  const inbox = useInboxSummary(social, missions, chests, dailyReady, messages.unread);
  const push = usePush(signedIn && p.online ? p.profile!.id : undefined, lang);
  const install = useInstall();

  // Notifications: ask every time the app opens until this device has them on (the device
  // tells us — see push.ts). Only on Inicio, never on top of another sheet.
  const wantsPush = signedIn && p.online && pushNeedsPrompt(push);
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    if (p.tab !== 'home' || !wantsPush || sheet || pushPromptShown) return;
    const id = setTimeout(() => { pushPromptShown = true; setSheet('push'); }, PUSH_PROMPT_MS);
    return () => clearTimeout(id);
  }, [p.tab, wantsPush, sheet, opened]);
  const { refresh: refreshPush } = push;
  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt < REOPEN_MS) return;
      pushPromptShown = false;
      refreshPush();
      setOpened((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPush]);
  const closeSheet = useCallback(() => setSheet(null), []);
  useEffect(() => { if (p.openInbox) setSheet('inbox'); }, [p.openInbox]);

  // Suggest the home-screen install after a moment on Inicio — never on top of another sheet,
  // and not after the notifications prompt already said to install (iPhone).
  useEffect(() => {
    if (p.tab !== 'home' || !install.nudge || sheet || (pushPromptShown && push.state === 'install')) return;
    const id = setTimeout(() => setSheet('install'), INSTALL_NUDGE_MS);
    return () => clearTimeout(id);
  }, [p.tab, install.nudge, sheet, push.state]);

  // Walked out of a game that's still going? Offer the way back. And: is this the admin?
  useEffect(() => {
    if (!signedIn) return;
    api<{ roomId?: string }>('queue_status').then((s) => setActiveRoom(s.roomId ?? null)).catch(() => {});
    if (!p.guest) api<{ admin: boolean }>('am_i_admin').then((r) => setAdmin(r.admin)).catch(() => {});
  }, [signedIn, p.guest]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); }
  };
  const linkGoogle = () => run(async () => {
    const { error: e } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: authReturnUrl() } });
    if (e) throw new ApiError('link_failed');
  });
  const signInOr = (fn: () => void) => () => (signedIn ? fn() : p.onSignIn?.());
  const acceptInboxInvite = async (inv: Invite, forfeit = false): Promise<'in_game' | void> => {
    if (!social) return;
    if (inv.tournament_id) {
      const result = await social.answer(inv, true);
      if (result.tournamentId) {
        setSheet(null);
        p.onTournament?.(result.tournamentId);
      }
      return;
    }
    if (!inv.room_id) return;
    const joined = await joinInvitedRoom(inv.room_id, forfeit);
    if (joined === 'in_game') return 'in_game';
    social.answer(inv, true).catch(() => {});
    setSheet(null);
    p.onRoom?.(joined.roomId);
  };

  let body: ReactNode;
  if (p.tab === 'home') {
    body = (
      <HomeTab
        profile={p.profile} guest={p.guest} online={p.online}
        dailyReady={dailyReady}
        activeRoom={activeRoom}
        notice={error}
        onResume={() => activeRoom && p.onRoom?.(activeRoom)}
        onDaily={signInOr(() => setSheet('coins'))}
        onAvatar={signInOr(() => p.onTab('profile'))}
        onMode={(mode) => setSheet({ mode })}
        onArcade={() => setSheet('arcade')}
        onLinkGoogle={p.guest ? linkGoogle : undefined}
        missions={signedIn && missions.missions.length
          ? { done: missions.done, total: missions.missions.length, claimable: missions.claimable, onOpen: () => setSheet('missions') }
          : undefined}
        tournaments={
          <FeaturedTournaments enabled={p.online} onOpen={(id) => (signedIn ? p.onTournament?.(id, 'home') : p.onSignIn?.())} />
        }
        chests={
          <ChestSlots
            chests={chests}
            enabled={signedIn && !p.guest}
            onNeedAccount={() => (p.guest ? linkGoogle() : p.onSignIn?.())}
            onChanged={reloadChests}
          />
        }
      />
    );
  } else if (!signedIn) {
    body = (
      <div className="tab-page tab-empty">
        <p>{p.online ? t.signedOutTab : t.onlineSoon}</p>
        {p.online && p.onSignIn && <button className="btn primary" onClick={p.onSignIn}>{t.signIn}</button>}
      </div>
    );
  } else if (p.tab === 'tables') {
    body = (
      <TablesTab
        guest={p.guest} onCustom={() => p.onCustom?.()} onRoom={(id) => p.onRoom?.(id)} onCode={() => setSheet('code')}
        friends={<FriendsSection profile={p.profile!} onQuickInvite={setQuickInvite} onWatch={p.onWatch} push={push} />}
        tournaments={<TournamentsSection uid={p.profile!.id} onCreate={() => p.onNewTournament?.()} onOpen={(id) => p.onTournament?.(id)} />}
      />
    );
  } else if (p.tab === 'profile') {
    body = <ProfileTab profile={p.profile!} guest={p.guest} onLinkGoogle={linkGoogle} onTournament={p.onTournament} />;
  } else if (p.tab === 'shop') {
    body = <ShopTab profile={p.profile!} guest={p.guest} onLinkGoogle={linkGoogle} />;
  } else {
    body = <RankingTab me={p.profile!.id} />;
  }

  const modeSheet = sheet && typeof sheet === 'object' ? sheet : null;

  return (
    <GameShell
      tab={p.tab}
      onTab={p.onTab}
      badges={{ home: p.tab === 'home' ? 0 : missions.claimable }}
      top={<TopBar profile={p.profile} onSettings={() => setSheet('settings')} onInbox={signedIn && social ? () => setSheet('inbox') : undefined} inboxCount={inbox.count} onCoins={() => setSheet('coins')} onLevel={() => p.onTab('profile')} onSignIn={p.online ? p.onSignIn : undefined} />}
    >
      {body}
      {p.tab !== 'home' && error && <p className={error === t.shop.thanks ? 'note-ok center' : 'error'}>{error}</p>}

      {sheet === 'settings' && (
        <SettingsSheet onClose={() => setSheet(null)} onInstall={install.available ? () => setSheet('install') : undefined} extra={signedIn && (
          <>
            {p.online && <PushRow push={push} />}
            {p.online && <LastSeenRow />}
            {p.online && <SpectatorsHearRow initial={p.profile?.spectators_hear ?? true} />}
            {admin && <button className="btn primary wide" onClick={() => { setSheet(null); p.onAdmin?.(); }}>🛡️ {t.admin.title}</button>}
            <button className="link-btn signout" onClick={() => supabase.auth.signOut()}>{t.signOut}</button>
          </>
        )} />
      )}
      {sheet === 'missions' && <MissionsSheet m={missions} onClose={() => setSheet(null)} onChest={reloadChests} />}
      {sheet === 'inbox' && social && (
        <InboxSheet summary={inbox} missions={missions} social={social} messages={messages}
          initialFriendId={typeof p.openInbox === 'string' ? p.openInbox : undefined} onClose={() => setSheet(null)}
          onAcceptInvite={acceptInboxInvite} onChestChanged={reloadChests}
          onOpenDaily={() => setSheet('coins')}
          onOpenChests={() => { setSheet(null); p.onTab('home'); }} />
      )}
      {sheet === 'coins' && p.profile && (
        <CoinsSheet profile={p.profile} guest={p.guest} onClose={() => setSheet(null)} onError={setError} onLinkGoogle={linkGoogle} />
      )}
      {quickInvite && (
        <QuickInviteSheet friend={quickInvite} onClose={() => setQuickInvite(null)}
          onRoom={(id) => { setQuickInvite(null); p.onRoom?.(id); }}
          onCustom={(friendId) => { setQuickInvite(null); p.onCustom?.(friendId); }} />
      )}
      {sheet === 'code' && <CodeSheet onClose={() => setSheet(null)} onJoined={(id) => p.onRoom?.(id)} onTournament={(code) => p.onTournamentCode?.(code)} />}
      {sheet === 'install' && <InstallSheet install={install} onClose={() => setSheet(null)} />}
      {sheet === 'push' && <PushPromptSheet push={push} onInstall={() => setSheet('install')} onClose={closeSheet} />}
      {sheet === 'arcade' && (
        <ArcadeSheet
          profile={p.profile} online={p.online} onSignIn={p.onSignIn} onClose={() => setSheet(null)}
          onPractice={() => p.onPractice('2v2', 'arcade')}
          onOnline={() => { setSheet(null); p.onQueue?.(0, '2v2', 'arcade'); }}
          onPrivate={() => run(async () => {
            const { roomId } = await api<{ roomId: string }>('create_custom', { settings: { ruleset: 'arcade', turnSeconds: 25, visibility: 'private' } });
            setSheet(null);
            p.onRoom?.(roomId);
          })}
        />
      )}
      {modeSheet && (
        <ModeSheet
          mode={modeSheet.mode} profile={p.profile} guest={p.guest} online={p.online}
          onSala={(stake) => { setSheet(null); p.onQueue?.(stake, modeSheet.mode); }}
          onPractice={() => p.onPractice(modeSheet.mode)}
          onSignIn={p.onSignIn}
          onClose={() => setSheet(null)}
        />
      )}
    </GameShell>
  );
}

function CoinsSheet({ profile, guest, onClose, onError, onLinkGoogle }: {
  profile: Profile; guest: boolean; onClose: () => void; onError: (e: string) => void; onLinkGoogle: () => void;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const daily = canClaimDaily(profile);
  const rescue = profile.chips < CHIPS.rescueBelow && (!profile.last_rescue || profile.last_rescue < new Date().toISOString().slice(0, 10));
  const claim = (action: string) => async () => {
    setBusy(true);
    try { await api(action); } catch (e) { onError(errText(e)); } finally { setBusy(false); onClose(); }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>🪙 {t.getChips}</h2>
      <p className="big-balance">{profile.chips.toLocaleString()} <small>{t.chips}</small></p>
      {guest ? (
        <>
          <p className="fine">{t.guestBannerSub}</p>
          <button className="btn primary wide" onClick={onLinkGoogle}>{t.linkGoogle}</button>
        </>
      ) : (
        <div className="menu">
          <button className="btn daily big-btn" disabled={!daily || busy} onClick={claim('claim_daily')}>
            🎁 {t.dailyClaim}
            {!daily && <small>{t.dailyTomorrow}</small>}
          </button>
          <button className="btn ghost big-btn" disabled={!rescue || busy} onClick={claim('rescue')}>
            🛟 {t.rescueClaim}
            {!rescue && <small>{t.rescueNotYet}</small>}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** One box for both: 4 letters = a table, 5 letters = a tournament. */
function CodeSheet({ onClose, onJoined, onTournament }: { onClose: () => void; onJoined: (roomId: string) => void; onTournament: (code: string) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = code.length === 4 || code.length === 5;
  const join = async () => {
    if (code.length === 5) return onTournament(code);
    try {
      onJoined((await api<{ roomId: string }>('join_room', { code, switchTable: 'lobby' })).roomId);
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Sheet onClose={onClose}>
      <h2>🔑 {t.joinByCode}</h2>
      <input className="text-input code-input big" placeholder={t.code} value={code} maxLength={5} autoFocus
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && valid && join()} />
      <p className="fine">{t.codeHint}</p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" disabled={!valid} onClick={join}>{t.join}</button>
    </Sheet>
  );
}

// ---------- tabs ----------

function TablesTab({ guest, onCustom, onRoom, onCode, tournaments, friends }: {
  guest: boolean; onCustom: () => void; onRoom: (id: string) => void; onCode: () => void; tournaments: ReactNode; friends?: ReactNode;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [error, setError] = useState<string | null>(null);
  const shareGame = () => {
    const text = `${t.shareText} ${location.origin}${location.pathname}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };
  return (
    <div className="tab-page">
      <h2 className="tab-title">👥 {t.friendsTitle}</h2>
      <p className="fine">{t.friendsSub}</p>
      {friends}
      <div className="tab-actions">
        <button className="btn primary" onClick={onCustom}>＋ {t.quick.private}</button>
        <button className="btn ghost" onClick={onCode}>🔑 {t.quick.code}</button>
      </div>
      <button className="btn wa" onClick={shareGame}>📲 {t.shareGame}</button>
      {guest && <p className="fine people-only">🔒 {t.guestFreeOnly}</p>}
      {tournaments}
      <OpenTables guest={guest} onJoin={(roomId) => api<{ roomId: string }>('join_room', { roomId }).then((r) => onRoom(r.roomId)).catch((e) => setError(errText(e)))} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ProfileTab({ profile, guest, onLinkGoogle, onTournament }: {
  profile: Profile; guest: boolean; onLinkGoogle: () => void; onTournament?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const stats = usePlayerStats([profile.id])[profile.id];
  const history = useTournamentHistory(profile.id);
  const level = levelFromXp(profile.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const winRate = stats?.games ? Math.round((100 * stats.wins) / stats.games) : 0;
  return (
    <div className="tab-page profile-page">
      <PhotoPicker profile={profile} level={level} />
      <h2 className="tab-title">{profile.display_name}</h2>
      {profile.friend_code && <small className="player-code" title={t.names.codeTitle}>#{profile.friend_code}</small>}
      <button className="link-btn rename-btn" onClick={() => setRenaming(true)}>✏️ {t.names.change}</button>
      {renaming && <RenameSheet profile={profile} onClose={() => setRenaming(false)} />}
      <LevelBadge xp={profile.xp} big />
      <div className="xp-bar wide"><span style={{ width: `${(100 * (profile.xp - from)) / (to - from)}%` }} /></div>
      <small className="fine">{(to - profile.xp).toLocaleString()} {t.xpToNext} {level + 1}</small>
      <ChipBalance profile={profile} />
      <h3 className="section-title">{t.myStats}</h3>
      <div className="stat-grid">
        <div><b>{stats?.games ?? 0}</b><small>{t.stats.games}</small></div>
        <div><b>{winRate}%</b><small>{t.stats.winRate}</small></div>
        <div><b>{stats?.capicuas ?? 0}</b><small>{t.stats.capicuas}</small></div>
        <div><b>{stats?.pollonas ?? 0}</b><small>{t.stats.pollonas}</small></div>
        <div><b>🏆 {stats?.tournaments_won ?? 0}</b><small>{t.tour.trophies}</small></div>
        <div><b>🪙 {(stats?.biggest_pot ?? 0).toLocaleString()}</b><small>{t.stats.biggestPot}</small></div>
      </div>
      <h3 className="section-title">🏆 {t.tour.history}</h3>
      <TournamentHistoryList rows={history} self onOpen={onTournament} />
      <LookPicker />
      {guest && (
        <section className="guest-card">
          <strong>👤 {t.guestBanner}</strong>
          <small>{t.guestBannerSub}</small>
          <button className="btn primary" onClick={onLinkGoogle}>{t.linkGoogle}</button>
        </section>
      )}
      <button className="link-btn signout" onClick={() => supabase.auth.signOut()}>{t.signOut}</button>
    </div>
  );
}

/** The big profile picture: tap it to pick a photo from the phone; Google photo / remove underneath. */
export function PhotoPicker({ profile, level }: { profile: Profile; level: number }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googlePhoto, setGooglePhoto] = useState<string | null>(null);
  useEffect(() => {
    if (!onlineEnabled) return;
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      const id = u?.identities?.find((i) => i.provider === 'google')?.identity_data;
      const photo = id?.avatar_url ?? id?.picture ?? u?.user_metadata?.avatar_url ?? u?.user_metadata?.picture;
      setGooglePhoto(typeof photo === 'string' && photo.startsWith('https://') ? photo : null);
    });
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const current = profile.avatar_url ?? null;
  return (
    <>
      <button className={`avatar-card big photo-pick ${busy ? 'busy' : ''}`} disabled={busy} onClick={() => file.current?.click()} aria-label={t.photo.change}>
        <span className="avatar-face"><Avatar name={profile.display_name} url={current} /></span>
        <span className="avatar-star">{level}</span>
        <span className="photo-cam" aria-hidden>{busy ? '⏳' : '📷'}</span>
      </button>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) run(() => uploadAvatar(profile.id, f, current));
      }} />
      <div className="photo-actions">
        <button className="link-btn" disabled={busy} onClick={() => file.current?.click()}>{current ? t.photo.change : t.photo.add}</button>
        {googlePhoto && current !== googlePhoto && (
          <button className="link-btn" disabled={busy} onClick={() => run(() => setAvatar('google', current))}>{t.photo.useGoogle}</button>
        )}
        {current && <button className="link-btn" disabled={busy} onClick={() => run(() => setAvatar(null, current))}>{t.photo.remove}</button>}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

interface RankRow { id: string; display_name: string; xp: number; chips: number; wins: number; avatar_url: string | null }

function RankingTab({ me }: { me: string }) {
  const { t } = useI18n();
  const [by, setBy] = useState<'xp' | 'chips' | 'wins'>('xp');
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const cardStats = usePlayerStats(card ? [card] : [])[card ?? ''];
  useEffect(() => {
    setRows(null);
    supabase.from('profiles').select('id, display_name, xp, chips, wins, avatar_url').order(by, { ascending: false }).limit(50)
      .then(({ data }) => setRows((data ?? []).map((r) => ({ ...r, chips: Number(r.chips) })) as RankRow[]));
  }, [by]);
  const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
  return (
    <div className="tab-page">
      <h2 className="tab-title">🏆 {t.rankingTitle}</h2>
      <div className="seg">
        <button className={by === 'xp' ? 'on' : ''} onClick={() => setBy('xp')}>{t.byLevel}</button>
        <button className={by === 'chips' ? 'on' : ''} onClick={() => setBy('chips')}>{t.byChips}</button>
        <button className={by === 'wins' ? 'on' : ''} onClick={() => setBy('wins')}>{t.byWins}</button>
      </div>
      <ol className="rank-list">
        {rows?.map((r, i) => (
          <li key={r.id} className={r.id === me ? 'me' : ''} onClick={() => setCard(r.id)} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setCard(r.id)}>
            <span className="rank-pos">{medal(i)}</span>
            <span className="avatar"><Avatar name={r.display_name} url={r.avatar_url} /></span>
            <span className="rank-name">{r.display_name}<LevelBadge xp={r.xp} /></span>
            <b className="rank-value">{by === 'xp' ? `${levelFromXp(r.xp)}` : by === 'chips' ? `🪙 ${r.chips.toLocaleString()}` : r.wins}</b>
          </li>
        ))}
      </ol>
      {rows === null && <p className="fine">{t.loading}</p>}
      {card && cardStats && <ProfileCard stats={cardStats} onClose={() => setCard(null)} />}
    </div>
  );
}

// ---------- sign-in, name, queue, custom form, open tables ----------

function SignIn({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const google = () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authReturnUrl() } });
  const guest = async () => {
    setBusy(true);
    await supabase.auth.signInAnonymously();
    setBusy(false);
  };
  return (
    <div className="screen">
      <button className="link-btn back" onClick={onBack}>← {t.back}</button>
      <h1 className="logo small">Capicúa</h1>
      <h2 className="screen-title">{t.signInTitle}</h2>
      <div className="menu">
        <button className="btn primary big-btn" onClick={google}>{t.google}</button>
        <button className="btn ghost big-btn" disabled>
          {t.whatsapp}
          <small className="soon">{t.soon}</small>
        </button>
        <button className="btn ghost big-btn" onClick={guest} disabled={busy}>{t.guest}</button>
        <p className="fine">{t.guestNote}</p>
      </div>
    </div>
  );
}

/**
 * Before playing: pick a name. Google's first name comes filled in; a player whose
 * name another player had first sees it here too, marked as taken, with free ones to tap.
 */
export function NamePrompt({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const tooLong = profile.display_name.trim().length > NAME_MAX;
  const prefilled = profile.display_name === 'Jugador' ? '' : fitName(profile.display_name);
  return (
    <div className="screen">
      <h1 className="logo small">Capicúa</h1>
      <h2 className="screen-title">{t.yourName}</h2>
      <p className="fine name-why">{tooLong ? t.names.tooLong : t.names.unique}</p>
      <div className="menu">
        <NameEditor initial={prefilled} submitLabel={t.save} onSaved={reloadProfile} />
      </div>
    </div>
  );
}

/** Perfil → Cambiar nombre: once every 7 days (the first change after picking it is free). */
export function RenameSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const { t, lang } = useI18n();
  const next = nextRename(profile.name_changed_at);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet rename-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{t.names.change}</h2>
        {next ? (
          <p className="fine">{t.names.cooldown.replace('{date}', new Date(next).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: 'numeric', month: 'long' }))}</p>
        ) : <>
          <p className="fine">{t.names.every.replace('{n}', String(RENAME_DAYS))}</p>
          <NameEditor initial={profile.display_name} current={profile.display_name} submitLabel={t.save} onSaved={() => { reloadProfile(); onClose(); }} />
        </>}
        {profile.friend_code && <p className="fine">{t.names.codeStays.replace('{code}', profile.friend_code)}</p>}
        <button className="btn ghost wide" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}

interface OpenTable { id: string; code: string; mode: Mode; stake: number; rules: { target: number; ruleset?: Ruleset; tranque?: string }; seated: number; host: string }

function OpenTables({ guest, onJoin }: { guest: boolean; onJoin: (roomId: string) => void }) {
  const { t } = useI18n();
  const [tables, setTables] = useState<OpenTable[] | null>(null);
  const load = useCallback(async () => {
    const { data: rooms } = await supabase.from('rooms').select('id, code, mode, stake, rules, host')
      .eq('kind', 'custom').eq('visibility', 'public').eq('phase', 'lobby').order('created_at', { ascending: false }).limit(20);
    if (!rooms?.length) return setTables([]);
    const { data: seats } = await supabase.from('room_seats').select('room_id, user_id, name').in('room_id', rooms.map((r) => r.id));
    setTables(rooms.map((r) => ({
      ...r,
      seated: seats?.filter((s) => s.room_id === r.id).length ?? 0,
      host: seats?.find((s) => s.room_id === r.id && s.user_id === r.host)?.name ?? '',
    })) as OpenTable[]);
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="card">
      <div className="card-head">
        <h3>{t.openTables}</h3>
        <button className="link-btn" onClick={load}>{t.refresh}</button>
      </div>
      {tables?.length === 0 && <p className="fine">{t.noOpenTables}</p>}
      {tables?.map((r) => (
        <button key={r.id} className={`open-table ${guest && r.stake ? 'locked' : ''}`} disabled={guest && r.stake > 0} onClick={() => onJoin(r.id)}>
          <span>{r.rules.ruleset === 'arcade' ? <b>⚡ {t.arcade.name} · {t.arcade.goal}</b> : <><b>{t.modes[r.mode].name}</b> · {t.targetLbl} {r.rules.target}{r.rules.tranque === 'team' ? ` · ${t.reglasChip.general}` : ''}</>}</span>
          <span className="fine">{r.host} · {r.seated}/{r.mode === '1v1' ? 2 : 4} {t.players}</span>
          <span className="ot-stake">{r.stake ? `${guest ? '🔒' : '🪙'} ${r.stake.toLocaleString()}` : t.free}</span>
        </button>
      ))}
    </section>
  );
}

/** When to suggest something else: sooner when nobody else is searching, later when a table is just slow to fill. */
const QUIET_AFTER_S = { alone: 20, slow: 60, again: 120 };

export function QueueScreen({ stake, mode, ruleset = 'traditional', notice, onMatched, onCancel, onPractice, onCustom }: {
  stake: number; mode: Mode; ruleset?: Ruleset; notice?: string; onMatched: (roomId: string) => void; onCancel: () => void;
  /** Few players around: leave the line and play the bots offline instead. */
  onPractice?: (mode: Mode, ruleset: Ruleset) => void;
  /** …or open a private table to bring friends. */
  onCustom?: () => void;
}) {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState(1);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  /** "Seguir esperando" hides the suggestion; it comes back a while later. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api<{ roomId?: string; waiting?: number; idle?: boolean }>('queue_status');
        if (!alive) return;
        if (s.roomId) return onMatched(s.roomId);
        if (s.idle) return onCancel();
        if (s.waiting) setWaiting(s.waiting);
      } catch { /* try again next round */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearInterval(id); clearInterval(clock); };
  }, [onMatched, onCancel]);

  const secs = Math.floor((now - started) / 1000);
  const alone = waiting <= 1;
  const quiet = !!onPractice && (dismissedAt === null
    ? secs >= (alone ? QUIET_AFTER_S.alone : QUIET_AFTER_S.slow)
    : secs - dismissedAt >= QUIET_AFTER_S.again);
  const leaveThen = async (go: () => void) => { await api('queue_leave').catch(() => {}); go(); };
  return (
    <div className={`screen center queue-screen ${quiet ? 'quiet' : ''}`}>
      <div className="searching-tiles" aria-hidden><span /><span /><span /></div>
      <h2 className="screen-title">{t.searching}</h2>
      <p className="queue-meta">{ruleset === 'arcade' ? `⚡ ${t.arcade.name} · ${t.arcade.goal}` : `${stake === 0 ? `🤝 ${t.friendly}` : `${t.sala} ${stake.toLocaleString()}`} · ${t.modes[mode].name}`}</p>
      <p className="queue-clock">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</p>
      <p className="fine">{waiting} {t.inQueue}</p>
      {/* Bots only fill a table once a second person is searching (1 vs 1 needs just the two of them). */}
      {botsAllowed(mode, stake) && mode !== '1v1' && <p className="fine">{t.botsSoon}</p>}
      {notice && <p className="note-ok">{notice}</p>}
      {quiet && (
        <section className="card quiet-card" role="status">
          <b>{alone ? t.quiet.aloneTitle : t.quiet.slowTitle}</b>
          <p>{alone ? t.quiet.alone : t.quiet.slow}</p>
          <button className="btn primary wide" onClick={() => leaveThen(() => onPractice!(mode, ruleset))}>
            🤖 {t.quiet.practice}<small>{t.quiet.practiceSub}</small>
          </button>
          {onCustom && ruleset !== 'arcade' && (
            <button className="btn ghost wide" onClick={() => leaveThen(onCustom)}>👥 {t.quiet.friends}</button>
          )}
          <button className="link-btn" onClick={() => setDismissedAt(secs)}>{t.quiet.keepWaiting}</button>
        </section>
      )}
      <button className="btn ghost" onClick={() => leaveThen(onCancel)}>{t.cancel}</button>
    </div>
  );
}

export function CustomForm({ profile, guest = false, onBack, onCreated }: { profile: Profile; guest?: boolean; onBack: () => void; onCreated: (roomId: string) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [c, setC] = useState<CustomSettings>({
    ruleset: 'traditional', mode: '2v2', stake: guest ? 0 : 500, target: 200, capicuaBonus: true, paseCorridoBonus: true, paseSalidaBonus: true,
    turnSeconds: TURN_SECONDS.customDefault, visibility: 'private', reglas: 'patio', redeal5: false, bonusPoints: 25,
  });
  const bonus = c.bonusPoints ?? 25;
  const arcade = c.ruleset === 'arcade';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof CustomSettings>(k: K, v: CustomSettings[K]) => setC((x) => ({ ...x, [k]: v }));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated((await api<{ roomId: string }>('create_custom', { settings: c })).roomId);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const Seg = <T extends string | number | boolean>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
    <div className="seg">
      {options.map(([v, label]) => <button key={String(v)} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );

  return (
    <div className="screen">
      <div className="hub-top">
        <button className="link-btn back" onClick={onBack}>← {t.back}</button>
        <ChipBalance profile={profile} />
      </div>
      <h2 className="screen-title">{t.createCustom}</h2>
      <section className="card form">
        <label className="label">{t.arcade.ruleset}</label>
        <Seg value={c.ruleset ?? 'traditional'} options={[['traditional', t.arcade.traditional], ['arcade', `⚡ ${t.arcade.name}`]]} onChange={(v) => set('ruleset', v)} />
        {arcade ? <p className="fine left">{t.arcade.tagline}</p> : <>
        <label className="label">{t.modeLbl}</label>
        <Seg value={c.mode} options={MODES.map((m) => [m, t.modes[m].name])} onChange={(v) => set('mode', v)} />
        {c.mode === '2v2' && <>
          <label className="label">{t.reglasLbl}</label>
          <Seg value={c.reglas ?? 'patio'} options={REGLAS.map((r) => [r, t.reglas[r]])} onChange={(v) => set('reglas', v)} />
          <p className="fine left">{t.reglasHelp[c.reglas ?? 'patio']}</p>
        </>}
        <label className="label">{t.stakePerPlayer}</label>
        {guest ? (
          <p className="fine left people-only">🔒 {t.guestFreeOnly}</p>
        ) : (
          <>
            <div className="join-row">
              <input className="text-input" type="number" min={0} step={50} value={c.stake}
                onChange={(e) => set('stake', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </div>
            <Seg value={c.stake} options={[[0, t.free], [250, '250'], [500, '500'], [1000, '1,000'], [2500, '2,500']]} onChange={(v) => set('stake', v)} />
          </>
        )}
        <label className="label">{t.targetLbl}</label>
        <Seg value={c.target} options={[[100, '100'], [150, '150'], [200, '200']]} onChange={(v) => set('target', v)} />
        <label className="label">{t.bonusesLbl}</label>
        <div className="seg">
          <button className={c.capicuaBonus ? 'on' : ''} onClick={() => set('capicuaBonus', !c.capicuaBonus)}>{c.capicuaBonus ? '✓ ' : ''}{t.capicuaBonusLbl} +{bonus}</button>
          <button className={c.paseCorridoBonus ? 'on' : ''} onClick={() => set('paseCorridoBonus', !c.paseCorridoBonus)}>{c.paseCorridoBonus ? '✓ ' : ''}{t.paseBonusLbl} +{bonus}</button>
        </div>
        {c.mode === '2v2' && (
          <div className="seg">
            <button className={c.paseSalidaBonus ? 'on' : ''} onClick={() => set('paseSalidaBonus', !c.paseSalidaBonus)}>{c.paseSalidaBonus ? '✓ ' : ''}{t.paseSalidaLbl}</button>
          </div>
        )}
        {(c.capicuaBonus || c.paseCorridoBonus) && <>
          <label className="label">{t.bonusPointsLbl}</label>
          <Seg value={bonus} options={BONUS_POINTS.map((p) => [p, `+${p}`])} onChange={(v) => set('bonusPoints', v)} />
        </>}
        <div className="seg">
          <button className={c.redeal5 ? 'on' : ''} onClick={() => set('redeal5', !c.redeal5)}>{c.redeal5 ? '✓ ' : ''}{t.redeal5Lbl}</button>
        </div>
        </>}
        <label className="label">{t.turnTimerLbl}</label>
        <Seg value={c.turnSeconds} options={[[15, '15s'], [25, '25s'], [40, '40s']]} onChange={(v) => set('turnSeconds', v)} />
        <label className="label">{t.visibilityLbl}</label>
        <Seg value={c.visibility} options={[['private', t.privateLbl], ['public', t.publicLbl]]} onChange={(v) => set('visibility', v)} />
        {!arcade && c.stake > 0 && <p className="fine left people-only">{botsAllowed(c.mode, c.stake) ? t.ffaMinTwo : t.peopleOnly}</p>}
      </section>
      {error && <p className="error">{error}</p>}
      <button className="btn primary wide" disabled={busy || (!arcade && c.stake > profile.chips)} onClick={create}>{t.create}</button>
    </div>
  );
}

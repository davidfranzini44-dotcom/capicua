// The game's main screen, laid out like a mobile game lobby (Golf Battle style):
// currency bar, logo + daily gift, a big scene with chunky mode buttons,
// quick-action slots, and a bottom tab bar. Works signed-in, signed-out and
// with online play not configured (practice only).
import { useState, type ReactNode } from 'react';
import type { Mode, Tile } from '../../supabase/functions/_shared/domino.ts';
import { levelFromXp, MODES, SALAS, sideBetMultiplier, xpForLevel } from '../../supabase/functions/_shared/table.ts';
import { useI18n } from '../i18n';
import { snoozeInstall, type Install } from '../lib/install';
import type { Profile } from '../lib/supabase';
import { isSoundOn, setSoundOn } from '../quickchat';
import { Avatar } from './common';
import { TileShape } from './Tile';

export type Tab = 'shop' | 'profile' | 'home' | 'tables' | 'ranking';

// ---------- shell ----------

export function GameShell({ tab, onTab, top, children, badges }: {
  tab: Tab; onTab: (t: Tab) => void; top: ReactNode; children: ReactNode;
  /** Little red counters on tabs (e.g. friend requests on Mesas). */
  badges?: Partial<Record<Tab, number>>;
}) {
  const { t } = useI18n();
  const tabs: [Tab, string, string][] = [
    ['shop', '🛒', t.nav.shop],
    ['profile', '🧑', t.nav.profile],
    ['home', '🏠', t.nav.home],
    ['tables', '👥', t.nav.tables],
    ['ranking', '🏆', t.nav.ranking],
  ];
  return (
    <div className="game-shell">
      {top}
      <main className={`game-body tab-${tab}`}>{children}</main>
      <nav className="bottom-nav">
        {tabs.map(([id, icon, label]) => (
          <button key={id} className={`nav-tab ${tab === id ? 'on' : ''}`} onClick={() => onTab(id)}>
            <span className="nav-icon">{icon}{!!badges?.[id] && <b className="nav-badge">{badges[id]}</b>}</span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function TopBar({ profile, onSettings, onCoins, onLevel, onSignIn }: {
  profile: Profile | null; onSettings: () => void; onCoins: () => void; onLevel: () => void; onSignIn?: () => void;
}) {
  const { t } = useI18n();
  const level = profile ? levelFromXp(profile.xp) : 1;
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return (
    <header className="top-bar">
      <button className="tb-gear" onClick={onSettings} aria-label={t.settings}>⚙️</button>
      {profile ? (
        <>
          <button className="tb-pill level-pill" onClick={onLevel}>
            <span className="pill-icon star">★<b>{level}</b></span>
            <span className="pill-bar"><span style={{ width: `${(100 * (profile.xp - from)) / (to - from)}%` }} /></span>
          </button>
          <button className="tb-pill coin-pill" onClick={onCoins}>
            <span className="pill-icon">🪙</span>
            <span className="pill-value">{profile.chips.toLocaleString()}</span>
            <span className="pill-plus">+</span>
          </button>
        </>
      ) : (
        onSignIn && <button className="tb-signin" onClick={onSignIn}>{t.signIn}</button>
      )}
    </header>
  );
}

// ---------- home ----------

export interface HomeProps {
  profile: Profile | null;
  guest: boolean;
  /** Online play configured (Supabase keys present). */
  online: boolean;
  dailyReady: boolean;
  activeRoom: string | null;
  notice?: string | null;
  onResume: () => void;
  onDaily: () => void;
  onAvatar: () => void;
  onMode: (mode: Mode) => void;
  onLinkGoogle?: () => void;
  /** The chest slots row (needs the signed-in player's chests). */
  chests: ReactNode;
  /** Today's missions (signed in): how many are done and ready to collect. */
  missions?: { done: number; total: number; claimable: number; onOpen: () => void };
}

export function HomeTab(p: HomeProps) {
  const { t } = useI18n();
  const level = p.profile ? levelFromXp(p.profile.xp) : null;
  const invite = () => {
    const text = `${t.shareText} ${location.origin}${location.pathname}`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div className="home2">
      <div className="home-head">
        <div className="logo2" aria-label="Capicúa Dominó">
          <span className="logo-top">CAPICÚA</span>
          <span className="logo-bottom">DOMINÓ</span>
        </div>
        <div className="head-buttons">
          <button className="chip-btn gift" onClick={p.onDaily} disabled={!p.profile || p.guest}>
            <span>🎁</span>{t.dailyGift}
            {p.dailyReady && <i className="dot">!</i>}
          </button>
          <button className="chip-btn invite" onClick={invite}><span>📲</span>{t.inviteShort}</button>
          {p.missions && (
            <button className="chip-btn missions" onClick={p.missions.onOpen} aria-label={t.missions.title}>
              <span>🎯</span>{p.missions.done}/{p.missions.total}
              {p.missions.claimable > 0 && <i className="dot">{p.missions.claimable}</i>}
            </button>
          )}
        </div>
        <button className="avatar-card" onClick={p.onAvatar}>
          <span className="avatar-face">{p.profile ? <Avatar name={p.profile.display_name} url={p.profile.avatar_url} /> : '?'}</span>
          {level && <span className="avatar-star">{level}</span>}
        </button>
      </div>

      {p.guest && p.onLinkGoogle && (
        <button className="guest-strip" onClick={p.onLinkGoogle}>👤 {t.guestBanner} <b>{t.linkGoogle} →</b></button>
      )}
      {p.notice && <p className="home-notice">{p.notice}</p>}

      <section className="stage">
        <HeroArt />
        <div className="mode-stack">
          {p.activeRoom && (
            <button className="resume-btn" onClick={p.onResume}>▶ {t.resumeGame}</button>
          )}
          {MODES.map((m) => (
            <button key={m} className={`mode-btn mode-${m}`} onClick={() => p.onMode(m)}>
              <span className="mode-icon"><ModeIcon mode={m} /></span>
              <span className="mode-text">
                {t.modes[m].short}
                <small>{t.modes[m].sub}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      {p.chests}
    </div>
  );
}

// ---------- sheets ----------

export function Sheet({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet game-sheet ${className}`} onClick={(e) => e.stopPropagation()}>
        <button className="sheet-x" onClick={onClose} aria-label="close">✕</button>
        {children}
      </div>
    </div>
  );
}

/** After tapping a mode: the public salas for it, plus free practice against bots. */
export function ModeSheet({ mode, profile, guest, online, onSala, onPractice, onSignIn, onClose }: {
  mode: Mode; profile: Profile | null; guest: boolean; online: boolean;
  onSala: (stake: number) => void; onPractice: () => void; onSignIn?: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onClose} className={`mode-sheet sheet-${mode}`}>
      <div className="sheet-icon"><ModeIcon mode={mode} /></div>
      <h2>{t.modes[mode].name}</h2>
      <p className="fine">{t.modes[mode].sub} · {t.targetLbl} 100</p>
      <div className="sala-list">
        {/* Friendly: online against real people, nothing on the line — guests welcome. */}
        {(() => {
          const lock = !online ? t.soon : !profile ? t.signInToBet : null;
          return (
            <button className={`sala-row friendly ${lock ? 'locked' : ''}`}
              disabled={!!lock && !(lock === t.signInToBet && onSignIn)}
              onClick={() => (lock === t.signInToBet ? onSignIn?.() : onSala(0))}>
              <span className="sr-name">🤝 {t.friendly}</span>
              <span className="sr-meta">{lock ? `🔒 ${lock}` : t.friendlySub}</span>
              <span className="sr-pot">{t.free}</span>
            </button>
          );
        })()}
        {SALAS.map((s, i) => {
          let lock: string | null = null;
          if (!online) lock = t.soon;
          else if (!profile) lock = t.signInToBet;
          else if (guest) lock = t.accountOnly;
          else if (profile.chips < s.minBalance) lock = `${t.locked} ${s.minBalance.toLocaleString()}`;
          return (
            <button key={s.stake} className={`sala-row tier-${i} ${lock ? 'locked' : ''}`}
              disabled={!!lock && !(lock === t.signInToBet && onSignIn)}
              onClick={() => (lock === t.signInToBet ? onSignIn?.() : onSala(s.stake))}>
              <span className="sr-name">{t.sala} {s.stake.toLocaleString()}</span>
              <span className="sr-meta">
                {lock ? `🔒 ${lock}` : `${t.entry}: ${s.minBalance.toLocaleString()}`}
              </span>
              <span className="sr-pot">🪙 {s.stake.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <button className="btn ghost wide practice-row" onClick={onPractice}>
        🤖 {t.practiceFree}
        <small>{t.practiceFreeSub}</small>
      </button>
    </Sheet>
  );
}

export function SettingsSheet({ onClose, onInstall, extra }: { onClose: () => void; onInstall?: () => void; extra?: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const [rules, setRules] = useState(false);
  const [sound, setSound] = useState(isSoundOn);
  const [auto, setAuto] = useState(() => {
    try { return localStorage.getItem('capicua.autoplay') !== '0'; } catch { return true; }
  });
  if (rules) return <RulesSheet onClose={() => setRules(false)} />;
  return (
    <Sheet onClose={onClose}>
      <h2>⚙️ {t.settings}</h2>
      <div className="setting-row">
        <span>{t.language}</span>
        <div className="seg">
          <button className={lang === 'es' ? 'on' : ''} onClick={() => setLang('es')}>Español</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
        </div>
      </div>
      <div className="setting-row">
        <span>{t.sound}</span>
        <div className="seg">
          <button className={sound ? 'on' : ''} onClick={() => { setSound(true); setSoundOn(true); }}>🔊</button>
          <button className={!sound ? 'on' : ''} onClick={() => { setSound(false); setSoundOn(false); }}>🔇</button>
        </div>
      </div>
      <div className="setting-row">
        <span>{t.auto} <small className="fine left">{t.autoplayHint}</small></span>
        <div className="seg">
          <button className={auto ? 'on' : ''} onClick={() => { setAuto(true); try { localStorage.setItem('capicua.autoplay', '1'); } catch { /* */ } }}>On</button>
          <button className={!auto ? 'on' : ''} onClick={() => { setAuto(false); try { localStorage.setItem('capicua.autoplay', '0'); } catch { /* */ } }}>Off</button>
        </div>
      </div>
      <button className="btn ghost wide" onClick={() => setRules(true)}>📖 {t.quick.rules}</button>
      {onInstall && <button className="btn ghost wide" onClick={onInstall}>📲 {t.install.settings}</button>}
      {extra}
    </Sheet>
  );
}

/** "Put Capicúa on your home screen": the real Install button where the browser allows it, Share-menu steps on iPhone. */
export function InstallSheet({ install, onClose }: { install: Install; onClose: () => void }) {
  const { t } = useI18n();
  const later = () => {
    snoozeInstall();
    onClose();
  };
  return (
    <Sheet onClose={later} className="install-sheet">
      <img className="install-icon" src="/icons/icon-192.png" alt="" width={84} height={84} />
      <h2>{t.install.title}</h2>
      <p className="fine">{t.install.sub}</p>
      {install.kind === 'prompt' && (
        <>
          <button className="btn primary wide" onClick={async () => { await install.install(); onClose(); }}>📲 {t.install.button}</button>
          <button className="link-btn later" onClick={later}>{t.install.later}</button>
        </>
      )}
      {install.kind === 'ios' && (
        <>
          <ol className="install-steps">
            <li><ShareGlyph /><span>{t.install.ios[0]}</span></li>
            <li><AddGlyph /><span>{t.install.ios[1]}</span></li>
            <li><span className="ios-add">{t.install.add}</span><span>{t.install.ios[2]}</span></li>
          </ol>
          <button className="btn primary wide" onClick={later}>{t.install.gotIt}</button>
        </>
      )}
      {install.kind === 'ios-inapp' && (
        <>
          <p className="install-inapp">{t.install.inApp}</p>
          <button className="btn primary wide" onClick={later}>{t.install.gotIt}</button>
        </>
      )}
    </Sheet>
  );
}

/** iOS's Share icon and "Add to Home Screen" icon, so the steps match what's on screen. */
const ShareGlyph = () => (
  <svg className="ios-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5v11M8 7.5l4-4 4 4M8.5 10.5H7a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const AddGlyph = () => (
  <svg className="ios-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export function RulesSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet onClose={onClose}>
      <h2>📖 {t.rulesTitle}</h2>
      <ul className="rules-list">{t.rules.map((r) => <li key={r}>{r}</li>)}</ul>
      <h3 className="section-title">{t.sideBets}</h3>
      <table className="odds">
        <thead><tr><th /><th>1 vs 1</th><th>2 vs 2</th><th>{t.modes.ffa.short}</th></tr></thead>
        <tbody>
          {(['cap1', 'cap2', 'pollona'] as const).map((k) => (
            <tr key={k}>
              <td>{t.bets[k].solo}</td>
              {MODES.map((m) => <td key={m}>{sideBetMultiplier({ mode: m, target: 100 }, k)}x</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">{t.oddsNote}</p>
    </Sheet>
  );
}

// ---------- art ----------

/** Little tile arrangements for the mode buttons. */
export function ModeIcon({ mode }: { mode: Mode }) {
  const tile = (x: number, y: number, r: number, v: Tile, k: string) => (
    <g key={k} transform={`translate(${x} ${y}) rotate(${r})`}>
      <TileShape x={-0.5} y={-1} vertical first={v[0]} second={v[1]} />
    </g>
  );
  const tiles =
    mode === '1v1' ? [tile(-0.55, 0, -14, [6, 6], 'a'), tile(0.55, 0, 14, [3, 5], 'b')]
      : mode === '2v2' ? [tile(-0.9, -0.1, -18, [1, 4], 'a'), tile(-0.3, 0, -6, [6, 6], 'b'), tile(0.3, 0, 6, [2, 5], 'c'), tile(0.9, -0.1, 18, [3, 3], 'd')]
        : [tile(0, -0.2, 0, [5, 5], 'a'), tile(-0.8, 0.2, -40, [1, 2], 'b'), tile(0.8, 0.2, 40, [4, 6], 'c'), tile(0, 0.5, 90, [0, 3], 'd')];
  return <svg viewBox="-1.9 -1.6 3.8 3.4" className="mode-svg">{tiles}</svg>;
}

/** The scene behind the mode buttons: Caribbean sky and sea, palms, and a domino table. */
function HeroArt() {
  const palm = (x: number, flip: number, s: number) => (
    <g transform={`translate(${x} 200) scale(${flip * s} ${s})`}>
      <path d="M0 0 C 6 -40, 14 -80, 30 -118" stroke="#8a5a2b" strokeWidth="7" fill="none" strokeLinecap="round" />
      <path d="M0 0 C 6 -40, 14 -80, 30 -118" stroke="#6b4420" strokeWidth="7" fill="none" strokeDasharray="3 9" />
      {[-70, -30, 5, 40, 80, 120].map((a, i) => (
        <path key={i} d="M30 -118 q 22 -14 48 -2 q -26 -2 -48 8 z" fill={i % 2 ? '#2f9e44' : '#3fbf57'}
          transform={`rotate(${a} 30 -118)`} />
      ))}
      <circle cx="28" cy="-114" r="4" fill="#7a4a1c" />
      <circle cx="34" cy="-112" r="4" fill="#6b3f18" />
    </g>
  );
  return (
    // Anchored bottom-left: on tall phones the right edge is what gets cropped (the buttons cover it anyway).
    <svg className="hero-art" viewBox="0 0 360 360" preserveAspectRatio="xMinYMax slice" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#38b6f2" />
          <stop offset="1" stopColor="#bfeeff" />
        </linearGradient>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1fb5c9" />
          <stop offset="1" stopColor="#5fe0d0" />
        </linearGradient>
        <radialGradient id="felt2" cx="0.5" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#23a35e" />
          <stop offset="1" stopColor="#11683a" />
        </radialGradient>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff7c2" />
          <stop offset="0.5" stopColor="#ffe066" />
          <stop offset="1" stopColor="#ffe066" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Sky comes from the page behind, so it runs seamlessly up under the logo. */}
      <circle cx="70" cy="60" r="60" fill="url(#sun)" />
      <g fill="#fff" opacity=".85">
        <ellipse cx="250" cy="50" rx="34" ry="11" />
        <ellipse cx="275" cy="42" rx="22" ry="10" />
        <ellipse cx="150" cy="92" rx="26" ry="8" />
      </g>
      <rect y="150" width="360" height="60" fill="url(#sea)" />
      <path d="M0 150 Q 90 138 170 150 T 360 148 V152 H0 Z" fill="#3a9d6a" opacity=".55" />
      <rect y="196" width="360" height="20" fill="#f3dca2" />
      {palm(34, 1, 1.05)}
      {palm(318, -1, 0.85)}
      {/* The table */}
      <path d="M-20 360 L 30 236 Q 180 214 330 236 L 380 360 Z" fill="#6b3f22" />
      <path d="M-4 360 L 42 246 Q 180 226 318 246 L 364 360 Z" fill="url(#felt2)" />
      <g transform="translate(150 268) scale(13)" opacity=".95">
        {[[0, 0, 0, [3, 4]], [2.1, 0.1, 0, [4, 6]], [4.2, 0.2, 0, [6, 6]], [-2.1, 0.15, 0, [1, 3]]].map(([x, y, , v], i) => (
          <g key={i} transform={`translate(${x} ${y}) skewX(-8)`}>
            <TileShape x={0} y={0} vertical={false} first={(v as number[])[0]} second={(v as number[])[1]} />
          </g>
        ))}
      </g>
      {/* The star of the show: a big double six, standing */}
      <g transform="translate(62 250) rotate(-14) scale(46)">
        <ellipse cx="0.5" cy="2.08" rx="0.75" ry="0.12" fill="#000" opacity=".3" />
        <TileShape x={0} y={0} vertical first={6} second={6} className="hero-tile" />
      </g>
    </svg>
  );
}

// Admin → Patrocinios: sponsors whose logo is printed on the felt of the tables
// the admin picks, with what each one got (games, players, views, taps) and a
// report to send them. Logos are cleaned up in the browser before upload.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { FELTS } from '../../supabase/functions/_shared/cosmetics.ts';
import { normalizeLink, SPONSOR_SALAS, validateSponsor, type SponsorInput } from '../../supabase/functions/_shared/sponsors.ts';
import { useI18n } from '../i18n';
import { prepareSponsorLogo, removeSponsorLogo, sponsorImageUrl, uploadSponsorLogo, type PreparedLogo, type SponsorRow } from '../lib/sponsor';
import { api } from '../lib/supabase';
import { useErrorText } from './common';
import { SponsorMark } from './Sponsor';
import { HandTile } from './Tile';

export interface SponsorStatsRow extends SponsorRow {
  games: number; games_7d: number; players: number; views: number; views_7d: number; taps: number; tappers: number; taps_7d: number;
}

type Status = 'live' | 'scheduled' | 'paused' | 'ended';
export function sponsorStatus(s: Pick<SponsorRow, 'paused' | 'starts_at' | 'ends_at'>, now = Date.now()): Status {
  if (s.paused) return 'paused';
  if (s.ends_at && Date.parse(s.ends_at) <= now) return 'ended';
  if (Date.parse(s.starts_at) > now) return 'scheduled';
  return 'live';
}

const dateOnly = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
/** For <input type="datetime-local">. */
const localInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** A small table felt with the logo on it and a few dominoes on top, to judge how it looks. */
export function SponsorFelt({ mark, felt = 'verde', tiles = true, className = '' }: {
  mark: { url: string; style: 'color' | 'white'; opacity: number; size: number } | null; felt?: string; tiles?: boolean; className?: string;
}) {
  const f = FELTS.find((x) => x.id === felt) ?? FELTS[0];
  return (
    <div className={`sp-felt table-focus ${f.color ? 'felt-tint' : ''} ${className}`} style={{ '--felt-color': f.color ?? undefined } as CSSProperties}>
      <div className="table-rail"><div className="felt">
        <div className="board-wrap">
          {mark && <SponsorMark sponsor={mark} />}
          {tiles && (
            <div className="board-scene sp-tiles" aria-hidden>
              {([[6, 6], [6, 3], [3, 1], [1, 5]] as [number, number][]).map((tl) => <HandTile key={tl.join()} tile={tl} />)}
            </div>
          )}
        </div>
      </div></div>
    </div>
  );
}

export function SponsorsView() {
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const [list, setList] = useState<SponsorStatsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SponsorStatsRow | 'new' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const load = useCallback(() => {
    api<SponsorStatsRow[]>('admin_sponsors').then(setList).catch((e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(errText(e)); }
  };
  const togglePause = (s: SponsorStatsRow) => act(() => api('admin_sponsor_save', { sponsor: { ...toInput(s), paused: !s.paused } }));
  const remove = (s: SponsorStatsRow) => confirm(t.admin.sp.delConfirm) && act(async () => {
    const { imagePath } = await api<{ imagePath: string | null }>('admin_sponsor_delete', { id: s.id });
    if (imagePath) await removeSponsorLogo(imagePath);
  });
  const copyReport = async (s: SponsorStatsRow) => {
    const text = t.admin.sp.reportText
      .replace('{name}', s.name).replace('{from}', dateOnly(s.starts_at, lang))
      .replace('{to}', s.ends_at && Date.parse(s.ends_at) < Date.now() ? dateOnly(s.ends_at, lang) : t.admin.sp.now)
      .replace('{games}', s.games.toLocaleString()).replace('{players}', s.players.toLocaleString())
      .replace('{views}', s.views.toLocaleString()).replace('{taps}', s.taps.toLocaleString());
    try { await navigator.clipboard.writeText(text); setCopied(s.id); setTimeout(() => setCopied(null), 1500); } catch { prompt('', text); }
  };

  if (editing) {
    return <SponsorEditor initial={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />;
  }
  return (
    <div className="sp-list">
      <p className="fine left">{t.admin.sp.intro}</p>
      <button className="btn primary" onClick={() => setEditing('new')}>{t.admin.sp.add}</button>
      {error && <p className="error">{error}</p>}
      {list && list.length === 0 && <p className="fine">{t.admin.sp.none}</p>}
      {list?.map((s) => (
        <SponsorCard key={s.id} s={s} url={sponsorImageUrl(s.image_path)} copied={copied === s.id}
          onEdit={() => setEditing(s)} onPause={() => togglePause(s)} onReport={() => copyReport(s)} onDelete={() => remove(s)} />
      ))}
    </div>
  );
}

/** One sponsor: its logo on a mini table, where it runs, and what it got. */
export function SponsorCard({ s, url, copied, onEdit, onPause, onReport, onDelete }: {
  s: SponsorStatsRow; url: string; copied: boolean; onEdit: () => void; onPause: () => void; onReport: () => void; onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  const status = sponsorStatus(s);
  const ctr = s.views ? ` (${((100 * s.taps) / s.views).toFixed(1)}%)` : '';
  return (
          <article className="sp-card">
            <SponsorFelt mark={{ url, style: s.style, opacity: s.opacity, size: s.size }} tiles={false} className="mini" />
            <div className="sp-main">
              <div className="sp-head">
                <b>{s.name}</b>
                <span className={`sp-status ${status}`}>{t.admin.sp.status[status]}</span>
              </div>
              <small className="sp-where">{describeTables(s, t)} · {dateOnly(s.starts_at, lang)}{s.ends_at ? ` – ${dateOnly(s.ends_at, lang)}` : ''}</small>
              {s.link && <a className="sp-link" href={s.link} target="_blank" rel="noreferrer">{s.link}</a>}
              <div className="sp-stats">
                <div><b>{s.games.toLocaleString()}</b><small>{t.admin.sp.games}</small></div>
                <div><b>{s.players.toLocaleString()}</b><small>{t.admin.sp.players}</small></div>
                <div><b>{s.views.toLocaleString()}</b><small>{t.admin.sp.views}</small></div>
                <div><b>{s.taps.toLocaleString()}{ctr}</b><small>{t.admin.sp.taps}</small></div>
              </div>
              <small className="sp-week">{t.admin.sp.last7}: {s.games_7d} {t.admin.sp.games.toLowerCase()} · {s.views_7d} {t.admin.sp.views.toLowerCase()} · {s.taps_7d} {t.admin.sp.taps.toLowerCase()}</small>
              <div className="sp-actions">
                <button className="btn ghost small" onClick={onEdit}>{t.admin.sp.edit}</button>
                <button className="btn ghost small" onClick={onPause}>{s.paused ? t.admin.sp.resume : t.admin.sp.pause}</button>
                <button className="btn ghost small" onClick={onReport}>{copied ? t.admin.sp.copied : t.admin.sp.report}</button>
                <button className="btn danger small" onClick={onDelete}>{t.admin.sp.del}</button>
              </div>
            </div>
          </article>
  );
}

type T = ReturnType<typeof useI18n>['t'];
function describeTables(s: Pick<SponsorRow, 'salas' | 'custom' | 'tournaments' | 'tournament_codes'>, t: T) {
  const parts = s.salas.map((x) => (x === 0 ? t.admin.sp.friendly : `${t.admin.sp.sala} ${x.toLocaleString()}`));
  if (s.custom) parts.push(t.admin.sp.custom);
  if (s.tournaments) parts.push(s.tournament_codes.length ? `${t.admin.sp.tournaments} (${s.tournament_codes.join(', ')})` : t.admin.sp.tournaments);
  return parts.join(', ');
}

const toInput = (s: SponsorRow): SponsorInput => ({
  id: s.id, name: s.name, imagePath: s.image_path, link: s.link, style: s.style, opacity: s.opacity, size: s.size,
  salas: s.salas, custom: s.custom, tournaments: s.tournaments, tournamentCodes: s.tournament_codes, weight: s.weight,
  startsAt: s.starts_at, endsAt: s.ends_at, paused: s.paused,
});

export function SponsorEditor({ initial, onDone, onCancel, upload = uploadSponsorLogo }: {
  initial: SponsorRow | null; onDone: () => void; onCancel: () => void;
  /** The design preview swaps this for a fake upload. */
  upload?: (logo: PreparedLogo) => Promise<string>;
}) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [f, setF] = useState<SponsorInput>(() => initial ? toInput(initial) : {
    name: '', imagePath: '', link: null, style: 'color', opacity: 0.4, size: 0.6, salas: [], custom: false,
    tournaments: false, tournamentCodes: [], weight: 1, startsAt: new Date().toISOString(), endsAt: null, paused: false,
  });
  const [linkText, setLinkText] = useState(initial?.link ?? '');
  const [codesText, setCodesText] = useState(initial?.tournament_codes.join(', ') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [clearBg, setClearBg] = useState(true);
  const [logo, setLogo] = useState<PreparedLogo | null>(null);
  const [felt, setFelt] = useState('verde');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SponsorInput>(k: K, v: SponsorInput[K]) => setF((x) => ({ ...x, [k]: v }));

  // Re-prepare the logo when a new file is picked or "remove the background" changes.
  useEffect(() => {
    if (!file) return;
    let live = true;
    prepareSponsorLogo(file, clearBg).then((l) => { if (live) setLogo((old) => { if (old) URL.revokeObjectURL(old.url); return l; }); })
      .catch((e) => live && setError(errText(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, clearBg]);

  const imageUrl = logo?.url ?? (f.imagePath ? sponsorImageUrl(f.imagePath) : null);
  const link = linkText.trim() ? normalizeLink(linkText) : null;
  const codes = codesText.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const draft = { ...f, link, tournamentCodes: codes, imagePath: f.imagePath || 'pending.webp' };
  const valid = !!validateSponsor(draft) && !!imageUrl;
  const noTables = !f.salas.length && !f.custom && !f.tournaments && !codes.length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const imagePath = logo ? await upload(logo) : f.imagePath;
      await api('admin_sponsor_save', { sponsor: { ...draft, imagePath } });
      if (logo && initial && initial.image_path !== imagePath) await removeSponsorLogo(initial.image_path);
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const toggleSala = (x: number) => set('salas', f.salas.includes(x) ? f.salas.filter((y) => y !== x) : [...f.salas, x].sort((a, b) => a - b));

  return (
    <div className="sp-editor">
      <label className="label">{t.admin.sp.name}</label>
      <input className="text-input" maxLength={40} placeholder={t.admin.sp.namePh} value={f.name} onChange={(e) => set('name', e.target.value)} />

      <label className="label">{t.admin.sp.logo}</label>
      <label className="btn ghost sp-upload">
        {imageUrl ? t.admin.sp.change : t.admin.sp.pick}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) setFile(x); e.target.value = ''; }} />
      </label>
      <p className="fine left">{t.admin.sp.logoHint}</p>
      {logo?.hasBackground && (
        <label className="sp-check"><input type="checkbox" checked={clearBg} onChange={(e) => setClearBg(e.target.checked)} /> {t.admin.sp.clearBg}</label>
      )}

      <label className="label">{t.admin.sp.preview}</label>
      <SponsorFelt mark={imageUrl ? { url: imageUrl, style: f.style, opacity: f.opacity, size: f.size } : null} felt={felt} />
      <div className="sp-row">
        <span className="fine">{t.admin.sp.feltLbl}</span>
        <div className="seg">
          {['verde', 'azul', 'vino', 'grafito'].map((id) => {
            const x = FELTS.find((y) => y.id === id)!;
            return <button key={id} className={felt === id ? 'on' : ''} onClick={() => setFelt(id)} style={{ color: x.swatch }} aria-label={x.name.es}>●</button>;
          })}
        </div>
      </div>
      <label className="label">{t.admin.sp.look}</label>
      <div className="seg">
        <button className={f.style === 'color' ? 'on' : ''} onClick={() => set('style', 'color')}>{t.admin.sp.color}</button>
        <button className={f.style === 'white' ? 'on' : ''} onClick={() => set('style', 'white')}>{t.admin.sp.white}</button>
      </div>
      <label className="sp-slider">{t.admin.sp.opacity} <b>{Math.round(f.opacity * 100)}%</b>
        <input type="range" min={10} max={90} step={5} value={Math.round(f.opacity * 100)} onChange={(e) => set('opacity', Number(e.target.value) / 100)} />
      </label>
      <label className="sp-slider">{t.admin.sp.size} <b>{Math.round(f.size * 100)}%</b>
        <input type="range" min={30} max={90} step={5} value={Math.round(f.size * 100)} onChange={(e) => set('size', Number(e.target.value) / 100)} />
      </label>

      <label className="label">{t.admin.sp.link}</label>
      <input className="text-input" placeholder={t.admin.sp.linkPh} value={linkText} onChange={(e) => setLinkText(e.target.value)} />
      {linkText.trim() && <small className={link ? 'fine left' : 'error'}>{link ?? t.admin.sp.linkBad}</small>}

      <label className="label">{t.admin.sp.tables}</label>
      <div className="sp-chips">
        {SPONSOR_SALAS.map((x) => (
          <button key={x} className={`chip-toggle ${f.salas.includes(x) ? 'on' : ''}`} onClick={() => toggleSala(x)}>
            {x === 0 ? `🤝 ${t.admin.sp.friendly}` : `${t.admin.sp.sala} ${x.toLocaleString()}`}
          </button>
        ))}
        <button className={`chip-toggle ${f.custom ? 'on' : ''}`} onClick={() => set('custom', !f.custom)}>{t.admin.sp.custom}</button>
        <button className={`chip-toggle ${f.tournaments ? 'on' : ''}`} onClick={() => set('tournaments', !f.tournaments)}>🏆 {t.admin.sp.tournaments}</button>
      </div>
      {f.tournaments && (
        <>
          <label className="label">{t.admin.sp.codes}</label>
          <input className="text-input" placeholder={t.admin.sp.codesPh} value={codesText} onChange={(e) => setCodesText(e.target.value)} />
        </>
      )}

      <div className="sp-dates">
        <label>{t.admin.sp.from}
          <input className="text-input" type="datetime-local" value={localInput(Date.parse(f.startsAt))}
            onChange={(e) => e.target.value && set('startsAt', new Date(e.target.value).toISOString())} />
        </label>
        <label>{t.admin.sp.to}
          <input className="text-input" type="datetime-local" value={f.endsAt ? localInput(Date.parse(f.endsAt)) : ''}
            onChange={(e) => set('endsAt', e.target.value ? new Date(e.target.value).toISOString() : null)} />
        </label>
      </div>
      <label className="sp-slider">{t.admin.sp.weight} <b>{f.weight}</b>
        <input type="range" min={1} max={10} step={1} value={f.weight} onChange={(e) => set('weight', Number(e.target.value))} />
      </label>
      <label className="sp-check"><input type="checkbox" checked={f.paused} onChange={(e) => set('paused', e.target.checked)} /> {t.admin.sp.paused}</label>

      {noTables && <p className="fine left">{t.admin.sp.needTables}</p>}
      {!imageUrl && <p className="fine left">{t.admin.sp.needLogo}</p>}
      {error && <p className="error">{error}</p>}
      <div className="sp-actions">
        <button className="btn primary" disabled={busy || !valid} onClick={save}>{busy ? t.admin.sp.saving : t.admin.sp.save}</button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>{t.admin.sp.cancel}</button>
      </div>
    </div>
  );
}

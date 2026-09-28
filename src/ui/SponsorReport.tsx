// The page a sponsor opens from their private link (/?reporte=…): how their logo
// is doing, live, without signing in. Totals only — never who the players are.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { loadSponsorReport, sponsorImageUrl, sponsorStatus, type SponsorReport } from '../lib/sponsor';
import { describeTables, SponsorFelt } from './Sponsor';
import './table.css';

const REFRESH_MS = 60_000;
const locale = (lang: string) => (lang === 'es' ? 'es-DO' : 'en-US');

export default function SponsorReportPage({ token }: { token: string }) {
  const { t } = useI18n();
  const [report, setReport] = useState<SponsorReport | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true);
    loadSponsorReport(token).then(setReport, () => setReport((r) => r ?? null)).finally(() => setBusy(false));
  }, [token]);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);
  // A private link: keep it out of search engines.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    if (report) document.title = `${report.name} · ${t.report.title}`;
  }, [report, t]);

  if (report === undefined) return <div className="screen center"><p className="fine">{t.report.loading}</p></div>;
  if (report === null) return <div className="screen center"><p className="note-ok">{t.report.notFound}</p></div>;
  return <SponsorReportView r={report} busy={busy} onRefresh={load} />;
}

export function SponsorReportView({ r, busy, onRefresh, previewUrl }: {
  r: SponsorReport; busy?: boolean; onRefresh?: () => void;
  /** The design preview's stand-in logo. */
  previewUrl?: string;
}) {
  const { t, lang, setLang } = useI18n();
  const status = sponsorStatus(r);
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' });
  const period = `${day(r.starts_at)} – ${r.ends_at ? day(r.ends_at) : t.report.noEnd}`;
  const ctr = r.views ? `${((100 * r.taps) / r.views).toFixed(1)}%` : '—';
  const pct = r.max_views ? Math.min(100, (100 * r.views_used) / r.max_views) : 0;
  const n = (v: number) => v.toLocaleString(locale(lang));

  return (
    <div className="screen sp-report">
      <header className="spr-head">
        <span className="spr-brand">CAPICÚA</span>
        <div className="seg">
          <button className={lang === 'es' ? 'on' : ''} onClick={() => setLang('es')}>ES</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>

      <section className="card spr-hero">
        <SponsorFelt mark={{ url: previewUrl ?? sponsorImageUrl(r.image_path), style: r.style, opacity: r.opacity, size: r.size }} />
        <div className="spr-title">
          <small>{t.report.title} {t.report.on}</small>
          <h1>{r.name}</h1>
          <span className={`sp-status ${status}`}>{t.admin.sp.status[status]}</span>
        </div>
        <dl className="spr-facts">
          <div><dt>{t.report.period}</dt><dd>{period}</dd></div>
          <div><dt>{t.report.where}</dt><dd>{describeTables(r, t)}</dd></div>
        </dl>
      </section>

      <section className="spr-kpis" aria-label={t.report.title}>
        <div className="spr-kpi hero"><b>{n(r.views)}</b><span>{t.report.views}</span><small>{t.report.viewsHelp}</small></div>
        <div className="spr-kpi"><b>{n(r.players)}</b><span>{t.report.players}</span><small>{t.report.playersHelp}</small></div>
        <div className="spr-kpi"><b>{n(r.games)}</b><span>{t.report.games}</span><small>{t.report.gamesHelp}</small></div>
        <div className="spr-kpi"><b>{n(r.taps)} <em>{ctr}</em></b><span>{t.report.taps}</span><small>{t.report.tapsHelp}</small></div>
      </section>

      {r.max_views != null && (
        <section className="card spr-pkg">
          <div className="spr-pkg-head">
            <b>{t.report.package}</b>
            <span>{r.views_used >= r.max_views
              ? `✓ ${t.report.packageDone}`
              : t.report.packageLeft.replace('{n}', n(r.max_views - r.views_used))}</span>
          </div>
          <span className="sp-bar big" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></span>
          <small>{t.report.packageUsed.replace('{used}', n(r.views_used)).replace('{max}', n(r.max_views))}</small>
        </section>
      )}

      <section className="card spr-chart">
        <h2>{t.report.chart}</h2>
        <DailyViews days={r.days ?? []} />
        <details className="spr-table">
          <summary>{t.report.asTable}</summary>
          <table>
            <thead><tr><th>{t.report.day}</th><th>{t.report.views}</th><th>{t.report.taps}</th></tr></thead>
            <tbody>
              {[...(r.days ?? [])].reverse().map((d) => (
                <tr key={d.day}><td>{shortDay(d.day, lang)}</td><td>{n(d.views)}</td><td>{n(d.taps)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <footer className="spr-foot">
        <small>{t.report.updated.replace('{time}', new Date(r.updated_at).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' }))}</small>
        {onRefresh && <button className="btn ghost small" disabled={busy} onClick={onRefresh}>↻ {t.report.refresh}</button>}
        <small className="spr-made">{t.report.footer}</small>
      </footer>
    </div>
  );
}

/** "3 oct" — the dates come as plain days (Dominican time), so no timezone shift. */
function shortDay(isoDay: string, lang: string, weekday = false) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale(lang), weekday ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
}

/** Round up to 1, 2 or 5 × 10ⁿ so the axis reads cleanly. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 2, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const BAR = '#b98414';
const BAR_HOVER = '#f5c542';
const H = 170;
const PAD = { top: 18, bottom: 22, left: 34 };

/**
 * Views per day, one column per day (single series: the title names it, no
 * legend). Hover or tap a day for its views and taps; the busiest day is labelled.
 */
function DailyViews({ days }: { days: { day: string; views: number; taps: number }[] }) {
  const { t, lang } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((d) => d.views)));
  const plotW = Math.max(0, width - PAD.left);
  const plotH = H - PAD.top - PAD.bottom;
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const best = days.reduce((b, d, i) => (d.views > (days[b]?.views ?? -1) ? i : b), 0);
  const bar = (i: number, v: number) => {
    const x = PAD.left + i * slot + (slot - barW) / 2;
    const top = y(v);
    const h = PAD.top + plotH - top;
    const r = Math.min(4, barW / 2, h);
    return `M${x},${PAD.top + plotH}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${PAD.top + plotH}Z`;
  };
  const tip = hover !== null ? days[hover] : null;
  return (
    <div className="spr-plot" ref={ref} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={t.report.chart}>
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width} y1={y(v)} y2={y(v)} className="spr-grid" />
              <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end" className="spr-tick">{v.toLocaleString(locale(lang))}</text>
            </g>
          ))}
          {days.map((d, i) => d.views > 0 && (
            <path key={d.day} d={bar(i, d.views)} fill={hover === i ? BAR_HOVER : BAR} />
          ))}
          {days[best]?.views > 0 && hover === null && (
            <text x={PAD.left + best * slot + slot / 2} y={y(days[best].views) - 5} textAnchor="middle" className="spr-label">
              {days[best].views.toLocaleString(locale(lang))}
            </text>
          )}
          {[0, Math.floor(days.length / 2), days.length - 1].filter((i) => days[i]).map((i) => (
            <text key={i} x={PAD.left + i * slot + slot / 2} y={H - 5} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} className="spr-tick">
              {shortDay(days[i].day, lang)}
            </text>
          ))}
          {/* Hit targets: the whole column, bigger than the bar. */}
          {days.map((d, i) => (
            <rect key={`hit-${d.day}`} x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent"
              onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
          ))}
        </svg>
      )}
      {tip && hover !== null && (
        <div className="spr-tip" style={{ left: Math.min(Math.max(PAD.left + hover * slot + slot / 2, 70), width - 70), top: Math.max(0, y(tip.views) - 54) }}>
          <b>{shortDay(tip.day, lang, true)}</b>
          <span>{tip.views.toLocaleString(locale(lang))} {t.report.viewsWord} · {tip.taps.toLocaleString(locale(lang))} {t.report.tapsWord}</span>
        </div>
      )}
    </div>
  );
}

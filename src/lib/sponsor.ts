// Sponsored tables in the browser: the sponsor on this game's felt, counting taps
// on "Patrocinado por…", and (admin) turning an uploaded logo into a clean,
// trimmed, transparent image that sits well on the felt.
import { useEffect, useState } from 'react';
import { ApiError, onlineEnabled, supabase } from './supabase';

export interface SponsorRow {
  id: string;
  name: string;
  image_path: string;
  /** Logo for the face-down fichas; null = they carry the felt logo. */
  tile_image_path: string | null;
  link: string | null;
  style: 'color' | 'white';
  opacity: number;
  size: number;
  salas: number[];
  custom: boolean;
  tournaments: boolean;
  tournament_codes: string[];
  weight: number;
  starts_at: string;
  ends_at: string | null;
  paused: boolean;
  created_at: string;
  /** Views paid for (null = no cap) and used so far. */
  max_views: number | null;
  views_used: number;
  /** The secret in the sponsor's report link (admin only). */
  report_token: string;
}

export type SponsorStatus = 'live' | 'scheduled' | 'paused' | 'ended' | 'done';
/** Where a campaign stands: paused, over (by date), package used up, not started yet, or running. */
export function sponsorStatus(s: Pick<SponsorRow, 'paused' | 'starts_at' | 'ends_at' | 'max_views' | 'views_used'>, now = Date.now()): SponsorStatus {
  if (s.paused) return 'paused';
  if (s.ends_at && Date.parse(s.ends_at) <= now) return 'ended';
  if (s.max_views != null && s.views_used >= s.max_views) return 'done';
  if (Date.parse(s.starts_at) > now) return 'scheduled';
  return 'live';
}

/** What the table needs to print it. */
export interface TableSponsor {
  id: string;
  name: string;
  url: string;
  /** The logo on the face-down fichas, when the sponsor has one of its own. */
  tileUrl?: string | null;
  link: string | null;
  style: 'color' | 'white';
  opacity: number;
  size: number;
}

export const sponsorImageUrl = (path: string) => supabase.storage.from('sponsors').getPublicUrl(path).data.publicUrl;

export const toTableSponsor = (s: Pick<SponsorRow, 'id' | 'name' | 'image_path' | 'link' | 'style' | 'opacity' | 'size'> & { tile_image_path?: string | null }): TableSponsor => ({
  id: s.id, name: s.name, url: sponsorImageUrl(s.image_path), link: s.link, style: s.style, opacity: s.opacity, size: s.size,
  tileUrl: s.tile_image_path ? sponsorImageUrl(s.tile_image_path) : null,
});

const cache = new Map<string, TableSponsor | null>();

/** The sponsor stamped on a game (null: none). */
export function useSponsor(id: string | null | undefined): TableSponsor | null {
  const [loaded, setLoaded] = useState<{ id: string; s: TableSponsor | null } | null>(null);
  useEffect(() => {
    if (!id || !onlineEnabled || cache.has(id)) return;
    let live = true;
    // Players may read only what prints the logo (not the report link or the package).
    supabase.from('sponsors').select('id, name, image_path, tile_image_path, link, style, opacity, size').eq('id', id).maybeSingle().then(({ data }) => {
      const s = data ? toTableSponsor(data) : null;
      cache.set(id, s);
      if (live) setLoaded({ id, s });
    });
    return () => { live = false; };
  }, [id]);
  if (!id) return null;
  if (cache.has(id)) return cache.get(id)!;
  return loaded?.id === id ? loaded.s : null;
}

/**
 * How much of a logo's visible part is light, and how much dark. The cards give a logo its
 * own tile: white parts (lettering made for dark backgrounds) vanish on a white one, dark
 * parts on a dark one — so the tile is dark when the logo has more light than dark in it.
 */
export function logoShades(rgba: ArrayLike<number>): { light: number; dark: number } {
  let seen = 0;
  let light = 0;
  let dark = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 64) continue;
    seen++;
    const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
    if (lum > 200) light++;
    else if (lum < 70) dark++;
  }
  return seen ? { light: light / seen, dark: dark / seen } : { light: 0, dark: 0 };
}
export const isLightLogo = (rgba: ArrayLike<number>) => {
  const { light, dark } = logoShades(rgba);
  return light > 0.1 && light > dark;
};

const tones = new Map<string, Promise<boolean>>();
/** Is this logo light? Read once per image from a small copy (storage allows it cross-origin). */
function logoIsLight(url: string): Promise<boolean> {
  let p = tones.get(url);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = 64;
          const h = Math.max(1, Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth)));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(false);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(isLightLogo(ctx.getImageData(0, 0, w, h).data));
        } catch {
          resolve(false); // unreadable: keep the white tile
        }
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });
    tones.set(url, p);
  }
  return p;
}

/** True once a logo turns out to be light (until then, and for dark logos, false). */
export function useLightLogo(url: string | null | undefined): boolean {
  const [known, setKnown] = useState<{ url: string; light: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    logoIsLight(url).then((light) => { if (live) setKnown({ url, light }); });
    return () => { live = false; };
  }, [url]);
  return !!url && known?.url === url && known.light;
}

/** The page the sponsor opens to see their numbers (no sign-in). */
export const sponsorReportUrl = (token: string) => `${location.origin}/?reporte=${encodeURIComponent(token)}`;

/** What the sponsor's report page shows: totals only, never who the players are. */
export interface SponsorReport {
  name: string; image_path: string; link: string | null; style: 'color' | 'white'; opacity: number; size: number;
  salas: number[]; custom: boolean; tournaments: boolean; tournament_codes: string[];
  starts_at: string; ends_at: string | null; paused: boolean; max_views: number | null; views_used: number;
  games: number; players: number; views: number; taps: number; tappers: number;
  /** The last 30 days (Dominican time), oldest first. */
  days: { day: string; views: number; taps: number }[];
  updated_at: string;
}

/** Null when the link is wrong or was replaced. */
export async function loadSponsorReport(token: string): Promise<SponsorReport | null> {
  const { data, error } = await supabase.rpc('sponsor_report', { p_token: token });
  if (error) throw new ApiError('server_error');
  return (data as SponsorReport | null) ?? null;
}

/** "Patrocinado por…" was tapped: count it and open their link. */
export function openSponsor(s: TableSponsor, gameId?: string) {
  if (!s.link) return;
  supabase.rpc('sponsor_tap', { p_sponsor: s.id, p_game: gameId ?? null }).then(() => {}, () => {});
  window.open(s.link, '_blank', 'noopener');
}

// ---------- admin: preparing a logo ----------

/** Longest side of the saved logo (the one on the fichas is tiny: 256 is plenty). */
const MAX_SIDE = 800;
export const TILE_LOGO_SIDE = 256;
/** How close a pixel's color must be to the background to be cleared (0–441). */
const BG_TOLERANCE = 48;
/** Up to this far, edge pixels fade out instead of a hard cut. */
const BG_FEATHER = 90;

export interface PreparedLogo {
  blob: Blob;
  /** For the preview (revoke when done). */
  url: string;
  ext: 'webp' | 'png';
  width: number;
  height: number;
  /** The upload had a solid background (e.g. a white square) that can be cleared. */
  hasBackground: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ApiError('bad_photo'));
    img.src = src;
  });
}

const dist = (d: Uint8ClampedArray, i: number, c: [number, number, number]) =>
  Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);

/**
 * Makes an uploaded logo fit the table: clears a solid background (only the part
 * touching the edges, so white letters inside the logo stay), trims the empty
 * margins, and shrinks it to at most 800 px, keeping transparency.
 */
export async function prepareSponsorLogo(file: File, clearBackground: boolean, maxSide = MAX_SIDE): Promise<PreparedLogo> {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 800) * scale));
    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const ctx = work.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const d = data.data;

    // Already transparent (a PNG logo)? Otherwise, is there a solid background at the corners?
    let seeThrough = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) seeThrough++;
    const transparent = seeThrough > d.length / 4 / 7 / 100;
    const corner = (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]] as [number, number, number]; };
    const corners = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
    const bg = corners.map((c) => c).reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]) as [number, number, number];
    const hasBackground = !transparent && corners.every((c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]) < BG_TOLERANCE / 2);

    if (clearBackground && hasBackground) {
      // Flood from the edges over background-colored pixels.
      const cleared = new Uint8Array(w * h);
      const queue: number[] = [];
      const push = (p: number) => {
        if (cleared[p]) return;
        if (dist(d, p * 4, bg) >= BG_TOLERANCE) return;
        cleared[p] = 1;
        queue.push(p);
      };
      for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
      while (queue.length) {
        const p = queue.pop()!;
        const x = p % w;
        if (x > 0) push(p - 1);
        if (x < w - 1) push(p + 1);
        if (p >= w) push(p - w);
        if (p < w * (h - 1)) push(p + w);
      }
      for (let p = 0; p < w * h; p++) {
        if (cleared[p]) { d[p * 4 + 3] = 0; continue; }
        // Soften the cut next to the cleared area.
        const x = p % w;
        const nearCleared = (x > 0 && cleared[p - 1]) || (x < w - 1 && cleared[p + 1]) || (p >= w && cleared[p - w]) || (p < w * (h - 1) && cleared[p + w]);
        if (nearCleared) {
          const k = (dist(d, p * 4, bg) - BG_TOLERANCE) / (BG_FEATHER - BG_TOLERANCE);
          if (k < 1) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.max(0, k));
        }
      }
      ctx.putImageData(data, 0, 0);
    }

    // Trim the empty margins (anything nearly invisible), keeping a hair of padding.
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new ApiError('bad_photo'); // nothing left
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const out = Math.min(1, maxSide / Math.max(cw, ch));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cw * out));
    canvas.height = Math.max(1, Math.round(ch * out));
    const octx = canvas.getContext('2d')!;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(work, x0, y0, cw, ch, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new ApiError('bad_photo'))), 'image/webp', 0.92));
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    return { blob, url: URL.createObjectURL(blob), ext, width: canvas.width, height: canvas.height, hasBackground };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Uploads a prepared logo to the public `sponsors` bucket; returns its path. */
export async function uploadSponsorLogo(logo: PreparedLogo): Promise<string> {
  const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${logo.ext}`;
  const { error } = await supabase.storage.from('sponsors')
    .upload(path, logo.blob, { contentType: logo.ext === 'webp' ? 'image/webp' : 'image/png', cacheControl: '31536000' });
  if (error) throw new ApiError('upload_failed');
  return path;
}

export async function removeSponsorLogo(path: string) {
  await supabase.storage.from('sponsors').remove([path]).then(() => {}, () => {});
}

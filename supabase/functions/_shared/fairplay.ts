// Fair play helpers for the server: which network a request comes from, and how
// a public chip table is picked so people who know each other never share it.

/** The caller's address as the platform's proxy reports it. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('cf-connecting-ip')?.trim() || headers.get('x-real-ip')?.trim() || null;
}

/**
 * The network an address belongs to: an IPv4 address as is, an IPv6 one cut to
 * its /64 (every phone on one home router shares it). Null for anything that
 * isn't a public address — a proxy's private one would lump everybody together.
 */
export function networkOf(ip: string | null): string | null {
  if (!ip) return null;
  let a = ip.trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, '').replace(/%.*$/, '');
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(:\d+)?$/);
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])];
    if ([v4[1], v4[2], v4[3], v4[4]].some((x) => Number(x) > 255)) return null;
    const isPrivate = p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31)
      || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
    return isPrivate ? null : `${Number(v4[1])}.${q}.${Number(v4[3])}.${Number(v4[4])}`;
  }
  if (!a.includes(':') || !/^[0-9a-f:.]+$/.test(a)) return null;
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(':') : []).flatMap((g) => (g.includes('.') ? ['0', '0'] : [g]));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.some((g) => g.length > 4)) return null;
  const first = parseInt(groups[0], 16);
  // Loopback, link-local (fe80::/10) and unique-local (fc00::/7) addresses aren't anyone's home network.
  if (groups.every((g, i) => (i < 7 ? parseInt(g, 16) === 0 : true)) || (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** One key per unordered pair of players. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Choose who sits at a table from the queue (oldest first). Nobody who clashes
 * with someone already chosen is taken. If the oldest player can't complete a
 * table, the next ones get a chance so they don't wait behind them. Returns a
 * full table when one exists, otherwise the biggest group found (for bot fill).
 */
export function pickGroup<T>(pool: T[], need: number, clash: (a: T, b: T) => boolean): T[] {
  let best: T[] = [];
  for (let start = 0; start < pool.length; start++) {
    const group = [pool[start]];
    for (let i = 0; i < pool.length && group.length < need; i++) {
      if (i !== start && !group.some((g) => clash(g, pool[i]))) group.push(pool[i]);
    }
    const ordered = pool.filter((p) => group.includes(p));
    if (ordered.length >= need) return ordered;
    if (ordered.length > best.length) best = ordered;
  }
  return best;
}

/** An unbiased shuffle (Fisher–Yates). */
export function shuffled<T>(items: T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

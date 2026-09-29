import { describe, expect, it } from 'vitest';
import { copyText, nativeShare, parseShareSearch, shareUrl } from '../src/lib/shareMatch';
import { keptAuthParams } from '../src/lib/supabase';

const TOKEN = 'Q2FwaWN1YS1wcmV2aWV3LXRva2VuLW5vdC1yZWFs123';

describe('the shared-match address', () => {
  it('reads ?ver= (and &modo=transmision) and refuses anything that can\'t be a token', () => {
    expect(parseShareSearch(`?ver=${TOKEN}`)).toEqual({ token: TOKEN, broadcast: false });
    expect(parseShareSearch(`?ver=${TOKEN}&modo=transmision`)).toEqual({ token: TOKEN, broadcast: true });
    expect(parseShareSearch(`?ver=${TOKEN}&modo=otra`)).toEqual({ token: TOKEN, broadcast: false });
    expect(parseShareSearch('?sala=ABCD')).toBeNull();
    for (const bad of ['?ver=', '?ver=abc', `?ver=${TOKEN}%27`, `?ver=${'x'.repeat(65)}`, '?ver=<script>']) expect(parseShareSearch(bad)).toBe('malformed');
  });

  it('builds the watch and broadcast links from the page it runs on', () => {
    expect(shareUrl(TOKEN, false, 'https://capicua.app/')).toBe(`https://capicua.app/?ver=${TOKEN}`);
    expect(shareUrl(TOKEN, true, 'https://capicua.app/')).toBe(`https://capicua.app/?ver=${TOKEN}&modo=transmision`);
  });

  it('a sign-in round trip keeps only invite codes and a well-formed shared match', () => {
    expect(keptAuthParams(`?ver=${TOKEN}&modo=transmision&error=access_denied&utm=x`)).toBe(`ver=${TOKEN}&modo=transmision`);
    expect(keptAuthParams(`?sala=ABCD&ver=${TOKEN}`)).toBe(`sala=ABCD&ver=${TOKEN}`);
    // modo only ever rides along with a link, and a broken token goes nowhere.
    expect(keptAuthParams('?modo=transmision')).toBe('');
    expect(keptAuthParams('?ver=abc&modo=transmision')).toBe('');
    expect(keptAuthParams(`?ver=${TOKEN}&modo=admin`)).toBe(`ver=${TOKEN}`);
  });
});

describe('sending the link', () => {
  const data = { title: 't', text: 'x', url: 'https://capicua.app/?ver=x' };

  it('closing the share menu is "cancelled" — not an error, and nothing else happens', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    expect(await nativeShare(data, { share: async () => { throw abort; }, canShare: () => true })).toBe('cancelled');
  });

  it('shared, unavailable, or failed', async () => {
    expect(await nativeShare(data, { share: async () => {}, canShare: () => true })).toBe('shared');
    expect(await nativeShare(data, {} as Navigator)).toBe('unavailable');
    expect(await nativeShare(data, { share: async () => {}, canShare: () => false })).toBe('unavailable');
    expect(await nativeShare(data, { share: async () => { throw new Error('NotAllowedError'); }, canShare: () => true })).toBe('failed');
  });

  it('copying says true only when it really copied', async () => {
    let copied = '';
    expect(await copyText('hola', { clipboard: { writeText: async (t: string) => { copied = t; } } as Clipboard }, null)).toBe(true);
    expect(copied).toBe('hola');
    // Permission denied and no way around it: false (the sheet then says to press and hold).
    const denied = { clipboard: { writeText: async () => { throw new Error('denied'); } } as unknown as Clipboard };
    expect(await copyText('hola', denied, null)).toBe(false);
    // …or the old way, when the page allows it.
    const area = { value: '', style: {}, setAttribute: () => {}, select: () => {}, remove: () => {} };
    const doc = (ok: boolean) => ({ createElement: () => area, body: { appendChild: () => {} }, execCommand: () => ok }) as unknown as Document;
    expect(await copyText('hola', denied, doc(true))).toBe(true);
    expect(await copyText('hola', {} as Navigator, doc(false))).toBe(false);
  });
});

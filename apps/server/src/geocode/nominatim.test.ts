import { describe, expect, it } from 'vitest';
import { Geocoder } from './nominatim.ts';

function fakeFetch() {
  const calls: { url: string; at: number; agent: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, at: Date.now(), agent: (init?.headers as Record<string, string>)['User-Agent'] });
    return new Response(JSON.stringify([{ name: 'Test Mall', lat: '12.99', lon: '77.69', address: { suburb: 'Whitefield', city: 'Bengaluru' } }]));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('place search (Nominatim policy)', () => {
  it('sends an identifying User-Agent and returns tidy results', async () => {
    const { impl, calls } = fakeFetch();
    const geocoder = new Geocoder({ userAgent: 'Nukkad/test (contact)', fetchImpl: impl, spacingMs: 20 });
    expect(await geocoder.search('Test Mall')).toEqual([{ name: 'Test Mall', detail: 'Whitefield, Bengaluru', lat: 12.99, lng: 77.69 }]);
    expect(calls[0].agent).toBe('Nukkad/test (contact)');
    expect(calls[0].url).toContain('countrycodes=in');
  });

  it('caches results, so the same search is asked only once', async () => {
    const { impl, calls } = fakeFetch();
    const geocoder = new Geocoder({ userAgent: 'x', fetchImpl: impl, spacingMs: 20 });
    await geocoder.search('VR  Bengaluru');
    await geocoder.search('vr bengaluru ');
    expect(calls).toHaveLength(1);
  });

  it('never sends two requests closer together than the spacing', async () => {
    const { impl, calls } = fakeFetch();
    const geocoder = new Geocoder({ userAgent: 'x', fetchImpl: impl, spacingMs: 120 });
    await Promise.all([geocoder.search('aaa'), geocoder.search('bbb'), geocoder.search('ccc')]);
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(115);
  });
});

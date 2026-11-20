import { describe, expect, it } from 'vitest';
import { WeatherService, rainFromMillimetres } from './openMeteo.ts';

function fakeFetch(current: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ current }));
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('real weather (Open-Meteo)', () => {
  it('turns rainfall and weather codes into rain strength', async () => {
    const dry = new WeatherService({ fetchImpl: fakeFetch({ time: 't', precipitation: 0, weather_code: 1, cloud_cover: 30 }).impl });
    expect(await dry.current(12.92, 77.69)).toEqual({ rain: 0, cloud: 0.3, storm: false, at: 't' });
    const storm = new WeatherService({ fetchImpl: fakeFetch({ time: 't', precipitation: 1.2, weather_code: 95, cloud_cover: 100 }).impl });
    const s = await storm.current(12.92, 77.69);
    expect(s.rain).toBe(1);
    expect(s.storm).toBe(true);
    expect(rainFromMillimetres(0)).toBe(0);
    expect(rainFromMillimetres(0.2)).toBeGreaterThan(0.25);
    expect(rainFromMillimetres(10)).toBe(1);
  });

  it('asks once per place every 10 minutes, with coordinates rounded to ~5 km', async () => {
    const { impl, calls } = fakeFetch({ time: 't', precipitation: 0, weather_code: 0, cloud_cover: 0 });
    const service = new WeatherService({ fetchImpl: impl });
    await Promise.all([service.current(12.9201, 77.6902), service.current(12.921, 77.691), service.current(12.92, 77.69)]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('latitude=12.9&longitude=77.7');
  });

  it('fails clearly when the service is down', async () => {
    const down = new WeatherService({ fetchImpl: (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch });
    await expect(down.current(12.92, 77.69)).rejects.toThrow('503');
  });
});

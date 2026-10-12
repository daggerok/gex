/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { createMemoryStore, daysOlderThan, type StoredDay } from './store';

const day = (d: string, source: StoredDay['source'] = 'local'): StoredDay => ({ day: d, source, size: 10, tickers: ['SPY'], addedAt: 1, bytes: new Uint8Array([1, 2, 3]) });

describe('memory store', () => {
  test('lists days oldest first without their bytes, reads one with its bytes', async () => {
    const s = createMemoryStore();
    await s.put(day('2026-10-12'));
    await s.put(day('2026-10-09', 'site'));
    const list = await s.list();
    expect(list.map((m) => m.day)).toEqual(['2026-10-09', '2026-10-12']);
    expect('bytes' in list[0]).toBe(false);
    expect((await s.get('2026-10-09'))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(await s.get('2026-01-01')).toBeNull();
  });

  test('putting a day again replaces it', async () => {
    const s = createMemoryStore();
    await s.put(day('2026-10-09', 'site'));
    await s.put(day('2026-10-09', 'local'));
    expect((await s.list()).map((m) => m.source)).toEqual(['local']);
  });

  test('removes some days or everything', async () => {
    const s = createMemoryStore();
    for (const d of ['2026-10-07', '2026-10-09', '2026-10-12']) await s.put(day(d));
    await s.remove(['2026-10-09', '2026-01-01']);
    expect((await s.list()).map((m) => m.day)).toEqual(['2026-10-07', '2026-10-12']);
    await s.clear();
    expect(await s.list()).toEqual([]);
  });
});

describe('daysOlderThan', () => {
  const metas = ['2026-10-07', '2026-10-09', '2026-10-12'].map((d) => ({ day: d }));
  test('the chosen day itself stays, earlier ones go', () => {
    expect(daysOlderThan(metas, '2026-10-09')).toEqual(['2026-10-07']);
    expect(daysOlderThan(metas, '2026-10-13')).toEqual(['2026-10-07', '2026-10-09', '2026-10-12']);
    expect(daysOlderThan(metas, '2026-10-07')).toEqual([]);
  });
});

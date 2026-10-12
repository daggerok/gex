/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { CHART_ZOOM_KEY, CHART_ZOOM_KEY_V1, loadChartZooms, MAX_ZOOMED_TICKERS, parseLegacyZoom, parseZoomMap, saveChartZooms, withZoom, zoomFor } from './chart-zoom-store';

const memory = (init: Record<string, string> = {}) => {
  const m = new Map<string, string>(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
};

describe('every ticker keeps its own zoom', () => {
  test('zooming SPX does not throw away the zoom of SPY (the reported bug)', () => {
    let map = withZoom({}, 'SPY', [740, 790]);
    map = withZoom(map, 'SPX', [7400, 7900]);
    expect(zoomFor(map, 'SPY')).toEqual([740, 790]);
    expect(zoomFor(map, 'SPX')).toEqual([7400, 7900]);
  });

  test('a ticker at its default view has no entry, resetting one leaves the others', () => {
    let map = withZoom(withZoom({}, 'SPY', [740, 790]), 'SPX', [7400, 7900]);
    map = withZoom(map, 'SPY', null);
    expect(zoomFor(map, 'SPY')).toBeNull();
    expect(zoomFor(map, 'SPX')).toEqual([7400, 7900]);
    expect(zoomFor({}, 'QQQ')).toBeNull();
  });

  test('the input map is not changed', () => {
    const before = { SPY: [1, 2] as [number, number] };
    withZoom(before, 'SPX', [3, 4]);
    expect(before).toEqual({ SPY: [1, 2] });
  });

  test('past the limit the least recently used tickers are forgotten, using one moves it to the end', () => {
    let map = withZoom(withZoom(withZoom({}, 'A', [1, 2], 3), 'B', [1, 2], 3), 'C', [1, 2], 3);
    map = withZoom(map, 'A', [5, 6], 3); // A used again: now the newest
    map = withZoom(map, 'D', [1, 2], 3);
    expect(Object.keys(map)).toEqual(['C', 'A', 'D']);
  });

  test('a range that is not a range is not stored', () => {
    expect(withZoom({}, 'SPY', [5, 5])).toEqual({});
    expect(withZoom({}, 'SPY', [NaN, 5])).toEqual({});
  });
});

describe('how many tickers are remembered', () => {
  test('at least the last 20 tickers keep their zoom (owner requirement), the limit is well above that', () => {
    expect(MAX_ZOOMED_TICKERS).toBeGreaterThanOrEqual(20);
    let map = {};
    for (let i = 0; i < 25; i++) map = withZoom(map, `T${i}`, [i, i + 10]);
    for (let i = 0; i < 25; i++) expect(zoomFor(map, `T${i}`)).toEqual([i, i + 10]);
  });

  test('after 25 more tickers the 20 most recently used are still there', () => {
    let map = {};
    for (let i = 0; i < 400; i++) map = withZoom(map, `T${i}`, [i, i + 10]);
    for (let i = 380; i < 400; i++) expect(zoomFor(map, `T${i}`)).not.toBeNull();
    expect(zoomFor(map, 'T0')).toBeNull(); // the oldest are the ones forgotten
  });
});

describe('saved text', () => {
  test('save and load round trip, damaged or blocked storage gives no zooms', () => {
    const s = memory();
    saveChartZooms({ SPY: [740, 790], SPX: [7400, 7900] }, s);
    expect(loadChartZooms(s)).toEqual({ SPY: [740, 790], SPX: [7400, 7900] });
    expect(loadChartZooms(memory({ [CHART_ZOOM_KEY]: '{oops' }))).toEqual({});
    expect(loadChartZooms(null)).toEqual({});
    expect(() => saveChartZooms({ SPY: [1, 2] }, { getItem: () => null, setItem: () => { throw new Error('full'); } })).not.toThrow();
  });

  test('bad entries are dropped, good ones kept', () => {
    expect(parseZoomMap(JSON.stringify({ SPY: [1, 2], BAD: [3], WORSE: 'x', BACKWARDS: [9, 1] }))).toEqual({ SPY: [1, 2] });
    expect(parseZoomMap('[1,2]')).toEqual({});
    expect(parseZoomMap(null)).toEqual({});
  });

  test('the zoom saved by the first version (one ticker) is picked up until a new save exists', () => {
    const s = memory({ [CHART_ZOOM_KEY_V1]: JSON.stringify({ symbol: 'SPY', xZoom: [740, 790] }) });
    expect(loadChartZooms(s)).toEqual({ SPY: [740, 790] });
    saveChartZooms({ SPX: [7400, 7900] }, s);
    expect(loadChartZooms(s)).toEqual({ SPX: [7400, 7900] }); // the new key wins
    expect(parseLegacyZoom(JSON.stringify({ symbol: 'SPY', xZoom: null }))).toEqual({});
    expect(parseLegacyZoom('{oops')).toEqual({});
  });
});

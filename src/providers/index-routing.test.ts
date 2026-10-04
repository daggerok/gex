import { afterEach, describe, expect, test } from 'bun:test';
import type { ProviderContext } from '../types';
import { yahooChartSymbol } from './chart';
import { CBOE_INDEX_SYMBOLS, cboeProvider } from './cboe';
import { nasdaqProvider } from './nasdaq';
import { yahooProvider } from './yahoo';

const NEW_INDICES = ['XSP', 'NDX', 'DJX', 'RUT'];
const ctx = { proxyTemplate: '{url}', proxyBase: 'http://localhost:8787', token: '' } as ProviderContext;
const realFetch = globalThis.fetch;

/** Record requested URLs and answer with an empty-but-valid body. */
function captureFetch(body: unknown): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return seen;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('index symbol routing', () => {
  test.each(NEW_INDICES)('NASDAQ rejects %s with the index-options message', async (sym) => {
    await expect(nasdaqProvider.fetchAll!(sym, ctx)).rejects.toThrow(`NASDAQ does not support index options (${sym})`);
  });

  test.each(NEW_INDICES)('Yahoo requests ^%s', async (sym) => {
    const seen = captureFetch({ optionChain: { result: [{ expirationDates: [], quote: {} }] } });
    await yahooProvider.fetchMeta!(sym, ctx);
    expect(seen[0]).toBe(`http://localhost:8787/api/options?symbol=%5E${sym}`);
  });

  test.each(NEW_INDICES)('Cboe requests _%s', async (sym) => {
    expect(CBOE_INDEX_SYMBOLS.has(sym)).toBe(true);
    const seen = captureFetch({ data: { options: [] } });
    await cboeProvider.fetchAll!(sym, ctx);
    expect(seen[0]).toBe(`http://localhost:8787/api/cboe?symbol=_${sym}`);
  });

  test.each(NEW_INDICES)('chart uses ^%s', (sym) => {
    expect(yahooChartSymbol(sym)).toBe(`^${sym}`);
  });

  test('OEX stays CBOE-only (no caret on Yahoo, no NASDAQ index error)', () => {
    expect(yahooChartSymbol('OEX')).toBe('OEX');
    expect(CBOE_INDEX_SYMBOLS.has('OEX')).toBe(true);
  });
});

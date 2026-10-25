import { readFileSync, writeFileSync } from 'node:fs';
const edit = (f: string, a: string, b: string) => { const s = readFileSync(f, 'utf8'); if (!s.includes(a)) throw new Error(f + ' missing ' + a); writeFileSync(f, s.replace(a, b)); };
edit('src/gex.ts', `/** Resolved minimum second-wall distance in price units for \`symbol\` at \`spot\`. */
export function netGexPlusMinusMinDistance(symbol: string | null | undefined, spot: number): number {
    const rule = symbol ? NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL[symbol.toUpperCase()] : undefined;`, `/** Resolved minimum second-wall distance in price units for \`symbol\` at \`spot\`. \`bySymbol\` is the override table (tests pass their own). */
export function netGexPlusMinusMinDistance(symbol: string | null | undefined, spot: number, bySymbol: Readonly<Record<string, NetGexPlusMinusDistance>> = NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL): number {
    const rule = symbol ? bySymbol[symbol.toUpperCase()] : undefined;`);
edit('src/gex.test.ts', `    NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL.TEST_PCT = { pct: 0.005 };
    try {
      expect(netGexPlusMinusMinDistance('TEST_PCT', 800)).toBeCloseTo(4, 9);
    } finally {
      delete (NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL as Record<string, unknown>).TEST_PCT;
    }`, `    expect(netGexPlusMinusMinDistance('TEST_PCT', 800, { ...NET_GEX_PLUS_MINUS_DISTANCE_BY_SYMBOL, TEST_PCT: { pct: 0.005 } })).toBeCloseTo(4, 9);`);
edit('src/main.tsx', `                        agEnabled={gexMetrics.includes('absoluteGamma')}\n`, ``);

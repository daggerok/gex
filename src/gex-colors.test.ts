/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { AG_DOT_HOVER_RING, AG_DOT_STROKE_WIDTH, BOARD_PEAK_DOT, DEFAULT_LEVEL_COLORS, DEFAULT_METRIC_COLORS, GEX_BAR_COLORS, GEX_LEVEL_COLORS, mergeLevelColors } from './gex-colors';

describe('mergeLevelColors: saved colors survive the level key rename', () => {
  test('nothing saved or garbage -> defaults', () => {
    expect(mergeLevelColors(null)).toEqual(DEFAULT_LEVEL_COLORS);
    expect(mergeLevelColors('x')).toEqual(DEFAULT_LEVEL_COLORS);
    expect(mergeLevelColors({})).toEqual(DEFAULT_LEVEL_COLORS);
  });

  test('colors saved under the old keys land on the new keys', () => {
    const out = mergeLevelColors({ callWall: '#111111', putWall: '#222222', callWall2: '#333333', putWall2: '#444444', gammaRangeHigh: '#555555', gammaRangeLow: '#666666' });
    expect(out.maxNetGex).toBe('#111111');
    expect(out.minNetGex).toBe('#222222');
    expect(out.netGexPlus).toBe('#333333');
    expect(out.netGexMinus).toBe('#444444');
    expect(out.sumNetGexPlus).toBe('#555555');
    expect(out.sumNetGexMinus).toBe('#666666');
    expect(out.gammaFlip).toBe(DEFAULT_LEVEL_COLORS.gammaFlip);
  });

  test('a value under the new key wins over the legacy one, unchanged keys keep their value, non-strings are ignored', () => {
    const out = mergeLevelColors({ callWall: '#111111', maxNetGex: '#abcdef', spot: '#010203', maxPain: 5 });
    expect(out.maxNetGex).toBe('#abcdef');
    expect(out.spot).toBe('#010203');
    expect(out.maxPain).toBe(DEFAULT_LEVEL_COLORS.maxPain);
  });
});

describe('AG dots v3: hollow rings in the AG line colour (owner 2026-10-25)', () => {
    test('the hover ring token differs per theme and from the default AG colour', () => {
        expect(AG_DOT_HOVER_RING.light).not.toBe(AG_DOT_HOVER_RING.dark);
        for (const ring of Object.values(AG_DOT_HOVER_RING)) expect(ring).not.toBe(DEFAULT_METRIC_COLORS.absoluteGamma);
    });
    test('the ring stroke is 1.5-2 px', () => {
        expect(AG_DOT_STROKE_WIDTH).toBeGreaterThanOrEqual(1.5);
        expect(AG_DOT_STROKE_WIDTH).toBeLessThanOrEqual(2);
    });
});

describe('default green #089981 and red #f23645 (owner 2026-10-25, TradingView up and down colours)', () => {
    test('the sign colours and the Max / Min Net GEX levels use them, the OI / Volume metric colours stay', () => {
        expect(GEX_BAR_COLORS.call).toBe('#089981');
        expect(DEFAULT_METRIC_COLORS.netGexPos).toBe('#089981');
        expect(GEX_LEVEL_COLORS.maxNetGex).toEqual({ hex: '#089981', dot: 'bg-[#089981]' });
        expect(DEFAULT_LEVEL_COLORS.maxNetGex).toBe('#089981');
        expect(GEX_BAR_COLORS.put).toBe('#f23645');
        expect(DEFAULT_METRIC_COLORS.netGexNeg).toBe('#f23645');
        expect(GEX_LEVEL_COLORS.minNetGex).toEqual({ hex: '#f23645', dot: 'bg-[#f23645]' });
        expect(DEFAULT_LEVEL_COLORS.minNetGex).toBe('#f23645');
        expect(DEFAULT_METRIC_COLORS.putOi).toBe('#ef4444');
        expect(DEFAULT_METRIC_COLORS.putVolume).toBe('#fca5a5');
        expect(DEFAULT_METRIC_COLORS.callOi).toBe('#22c55e');
        expect(DEFAULT_METRIC_COLORS.callVolume).toBe('#86efac');
    });
});

describe('Board peak and runner-up dots: one blue per theme (owner 2026-10-25)', () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // a tint as index.css and BoardView mix it: `pct` of the colour into the opaque table base
  const mix = (c: string, base: string, pct: number) => rgb(c).map((v, i) => Math.round(v * pct + rgb(base)[i]! * (1 - pct)));

  test('sky-600 on the light table, sky-300 on the dark one, neither a sign colour', () => {
    expect(BOARD_PEAK_DOT).toEqual({ light: '#0284c7', dark: '#7dd3fc' });
    for (const c of Object.values(BOARD_PEAK_DOT)) expect([DEFAULT_METRIC_COLORS.netGexPos, DEFAULT_METRIC_COLORS.netGexNeg]).not.toContain(c);
  });

  test('at least 3:1 (WCAG 1.4.11) on the base, the peak tints and the ATM tint of its theme', () => {
    for (const [theme, base, atmPct] of [['light', '#ffffff', 0.22], ['dark', '#0f172a', 0.3]] as const) {
      const dot = rgb(BOARD_PEAK_DOT[theme]);
      const backs = [rgb(base), mix(DEFAULT_METRIC_COLORS.netGexPos, base, 0.16), mix(DEFAULT_METRIC_COLORS.netGexNeg, base, 0.16), mix(GEX_LEVEL_COLORS.spot.hex, base, atmPct)];
      for (const back of backs) expect(contrast(dot, back)).toBeGreaterThanOrEqual(3);
    }
  });
});

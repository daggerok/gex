/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { AG_DOT_HOVER_RING, AG_DOT_STROKE_WIDTH, DEFAULT_LEVEL_COLORS, DEFAULT_METRIC_COLORS, GEX_BAR_COLORS, GEX_LEVEL_COLORS, mergeLevelColors } from './gex-colors';

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

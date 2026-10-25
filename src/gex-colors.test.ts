/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { AG_DOT_COLORS, agDotColor, DEFAULT_LEVEL_COLORS, DEFAULT_METRIC_COLORS, mergeLevelColors } from './gex-colors';

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

describe('agDotColor: AG dots are blue by the sign of the strike Net GEX (owner 2026-10-25)', () => {
    test('light blue on negative, dark blue on positive and zero, per theme', () => {
        for (const dark of [false, true]) {
            const set = AG_DOT_COLORS[dark ? 'dark' : 'light'];
            expect(agDotColor(-1, dark)).toBe(set.neg);
            expect(agDotColor(1, dark)).toBe(set.pos);
            expect(agDotColor(0, dark)).toBe(set.pos);
        }
    });
    test('never the Net GEX (-) red, and the two shades differ in each theme', () => {
        for (const set of Object.values(AG_DOT_COLORS)) {
            expect(set.neg).not.toBe(set.pos);
            expect([set.pos, set.neg]).not.toContain(DEFAULT_METRIC_COLORS.netGexNeg);
            expect(set.hover).not.toBe(set.pos);
        }
    });
});

/// <reference types="bun" />
/// <reference types="node" />
import { beforeEach, describe, expect, test } from 'bun:test';
import type { CustomLevel } from './custom-levels';
import { DEFAULT_SELECTED_LEVELS, getLevelPrefs, levelPanelOrder, resetLevelPrefs, setLevelColor, toggleLevel } from './level-prefs';
import type { GexLevels } from './types';

const levels = (over: Partial<GexLevels> = {}): GexLevels => ({
  maxNetGex: 780, netGexPlus: 785, gammaFlip: 773.22, minNetGex: 770, netGexMinus: 765, sumNetGexPlus: 784, sumNetGexMinus: 764, maxPain: 774, spot: 778.57, ...over,
} as GexLevels);
const own = (id: string, price: number): CustomLevel => ({ id, name: id, price });

describe('levelPanelOrder', () => {
  test('built-in levels run from the lowest price to the highest (Net GEX- and 75% Sum Net GEX- swapped, see below)', () => {
    expect(levelPanelOrder(levels()).map((e) => e.key)).toEqual(['netGexMinus', 'sumNetGexMinus', 'minNetGex', 'gammaFlip', 'maxPain', 'spot', 'maxNetGex', 'sumNetGexPlus', 'netGexPlus']);
  });

  test('Net GEX- stays before 75% Sum Net GEX- even when the 75% level has the lower price', () => {
    const keys = levelPanelOrder(levels({ netGexMinus: 764, sumNetGexMinus: 760 })).map((e) => e.key);
    expect(keys.indexOf('netGexMinus')).toBeLessThan(keys.indexOf('sumNetGexMinus'));
  });

  test('a level without a price sinks to the far right', () => {
    const keys = levelPanelOrder(levels({ gammaFlip: null as unknown as number })).map((e) => e.key);
    expect(keys[keys.length - 1]).toBe('gammaFlip');
  });

  test('no levels at all keeps the base order', () => {
    expect(levelPanelOrder(null).map((e) => e.key)).toEqual(['maxNetGex', 'netGexPlus', 'gammaFlip', 'spot', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain']);
  });

  test("the user's own levels come first, by price, so they are never out of sight at the end of a scrolling row", () => {
    const entries = levelPanelOrder(levels(), [own('b', 801), own('a', 750)]);
    expect(entries.slice(0, 3).map((e) => e.key)).toEqual(['custom:a', 'custom:b', 'netGexMinus']);
    expect(entries[0].custom?.price).toBe(750);
    expect(entries[0].builtin).toBeNull();
    expect(entries[2].builtin).toBe('netGexMinus');
    expect(entries).toHaveLength(11);
  });
});

describe('shared level preferences', () => {
  beforeEach(() => resetLevelPrefs());

  test('start with the default selection and colours', () => {
    expect(getLevelPrefs().selected).toEqual(DEFAULT_SELECTED_LEVELS);
  });

  test('toggling a level turns it off and on, the result is a new object (so a re-render happens)', () => {
    const before = getLevelPrefs();
    toggleLevel('maxPain');
    expect(getLevelPrefs().selected).not.toContain('maxPain');
    expect(getLevelPrefs()).not.toBe(before);
    toggleLevel('maxPain');
    expect(getLevelPrefs().selected).toContain('maxPain');
  });

  test('a colour change is kept until reset', () => {
    setLevelColor('maxPain', '#123456');
    expect(getLevelPrefs().colors.maxPain).toBe('#123456');
    resetLevelPrefs();
    expect(getLevelPrefs().colors.maxPain).not.toBe('#123456');
  });
});

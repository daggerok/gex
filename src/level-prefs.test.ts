/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CustomLevel } from './custom-levels';
import { ALL_LEVEL_KEYS, DEFAULT_OFF_LEVELS, DEFAULT_SELECTED_LEVELS, gammaFlipUnavailableText, loadSelectedLevels, parseSelectedLevels, SELECTED_LEVELS_KEY, levelLabelItems, getLevelPrefs, levelPanelOrder, resetLevelPrefs, setLevelColor, sigmaLines, sigmaMode, toggleLevel, zeroGexDisplay } from './level-prefs';
import type { GexLevels, SigmaLevel } from './types';

const levels = (over: Partial<GexLevels> = {}): GexLevels => ({
  maxNetGex: 780, netGexPlus: 785, gammaFlip: 773.22, minNetGex: 770, netGexMinus: 765, sumNetGexPlus: 784, sumNetGexMinus: 764, maxPain: 774, maxAbsGamma: 777, zeroGex: 771, spot: 778.57, sigma: { pct: [], stat: null, statBasis: null }, ...over,
} as GexLevels);
const own = (id: string, price: number): CustomLevel => ({ id, name: id, price });

describe('levelPanelOrder', () => {
  test('built-in levels run from the lowest price to the highest (Net GEX- and 75% Sum Net GEX- swapped, see below)', () => {
    expect(levelPanelOrder(levels()).map((e) => e.key)).toEqual(['netGexMinus', 'sumNetGexMinus', 'minNetGex', 'zeroGex', 'gammaFlip', 'maxPain', 'maxAbsGamma', 'spot', 'sigma', 'maxNetGex', 'sumNetGexPlus', 'netGexPlus']);
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
    expect(levelPanelOrder(null).map((e) => e.key)).toEqual(['maxNetGex', 'netGexPlus', 'gammaFlip', 'zeroGex', 'spot', 'minNetGex', 'netGexMinus', 'sumNetGexPlus', 'sumNetGexMinus', 'maxPain', 'maxAbsGamma', 'sigma']);
  });

  test("the user's own levels come first, by price, so they are never out of sight at the end of a scrolling row", () => {
    const entries = levelPanelOrder(levels(), [own('b', 801), own('a', 750)]);
    expect(entries.slice(0, 3).map((e) => e.key)).toEqual(['custom:a', 'custom:b', 'netGexMinus']);
    expect(entries[0].custom?.price).toBe(750);
    expect(entries[0].builtin).toBeNull();
    expect(entries[2].builtin).toBe('netGexMinus');
    expect(entries).toHaveLength(14);
  });
});

describe('Max AG chip', () => {
  test('it has a chip only while the AG metric is on (the caller hides it otherwise)', () => {
    expect(levelPanelOrder(levels()).map((e) => e.key)).toContain('maxAbsGamma');
    const without = levelPanelOrder(levels(), [], ['maxAbsGamma']).map((e) => e.key);
    expect(without).not.toContain('maxAbsGamma');
    expect(without).toHaveLength(11);
  });

  test('it sits among the others by its price', () => {
    const keys = levelPanelOrder(levels()).map((e) => e.key);
    expect(keys.indexOf('maxAbsGamma')).toBe(keys.indexOf('maxPain') + 1); // 777 is between Max Pain 774 and Spot 778.57
  });

  test('it is on by default, like Max Pain', () => {
    expect(DEFAULT_SELECTED_LEVELS).toContain('maxAbsGamma');
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

describe('remembered level selection', () => {
  type MiniStorage = Pick<Storage, 'getItem' | 'setItem'>;
  const g = globalThis as unknown as { localStorage?: MiniStorage };
  let saved: MiniStorage | undefined;
  let store: Record<string, string>;
  beforeEach(() => {
    saved = g.localStorage;
    store = {};
    g.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  });
  afterEach(() => {
    resetLevelPrefs();
    g.localStorage = saved;
  });

  test('nothing stored, garbage or an array gives the defaults', () => {
    expect(parseSelectedLevels(null)).toEqual(DEFAULT_SELECTED_LEVELS);
    expect(parseSelectedLevels('{not json')).toEqual(DEFAULT_SELECTED_LEVELS);
    expect(parseSelectedLevels('["maxPain"]')).toEqual(DEFAULT_SELECTED_LEVELS);
    expect(loadSelectedLevels()).toEqual(DEFAULT_SELECTED_LEVELS);
  });

  test('stored booleans win, missing levels (added later) take their default, unknown keys are ignored', () => {
    const got = parseSelectedLevels(JSON.stringify({ maxPain: false, sigma: true, netGexPlus: 'yes', oldLevel: true }));
    expect(got).not.toContain('maxPain');
    expect(got).toContain('sigma');
    expect(got).not.toContain('netGexPlus'); // not a boolean: default (off)
    expect(got).toContain('zeroGex'); // missing: default (on)
    expect(got).not.toContain('oldLevel' as never);
    expect(got).toEqual(ALL_LEVEL_KEYS.filter((k) => got.includes(k))); // ALL_LEVEL_KEYS order
  });

  test('a toggle is saved for every known level, so a reload restores it; Reset saves the defaults', () => {
    toggleLevel('maxPain');
    toggleLevel('sigma');
    const map = JSON.parse(store[SELECTED_LEVELS_KEY]) as Record<string, boolean>;
    expect(Object.keys(map).sort()).toEqual([...ALL_LEVEL_KEYS].sort());
    expect([map.maxPain, map.sigma, map.zeroGex]).toEqual([false, true, true]);
    expect(loadSelectedLevels()).toEqual(getLevelPrefs().selected.slice().sort((a, b) => ALL_LEVEL_KEYS.indexOf(a) - ALL_LEVEL_KEYS.indexOf(b)));
    resetLevelPrefs();
    expect(loadSelectedLevels()).toEqual(DEFAULT_SELECTED_LEVELS);
  });

  test('a storage that throws keeps the defaults and toggling still works for the page', () => {
    g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSelectedLevels()).toEqual(DEFAULT_SELECTED_LEVELS);
    toggleLevel('maxPain');
    expect(getLevelPrefs().selected).not.toContain('maxPain');
  });
});

describe('Zero GEX chip', () => {
  test('it is a level like the others: on by default and placed by its price', () => {
    expect(DEFAULT_SELECTED_LEVELS).toContain('zeroGex');
    const keys = levelPanelOrder(levels()).map((e) => e.key);
    expect(keys.indexOf('zeroGex')).toBe(keys.indexOf('minNetGex') + 1); // 771 is between Min Net GEX 770 and Gamma Flip 773.22
  });

  test('its line / area switch starts as a line and Reset of the Levels panel brings the line back', () => {
    expect(zeroGexDisplay.get()).toBe('line');
    zeroGexDisplay.set('area');
    expect(zeroGexDisplay.get()).toBe('area');
    resetLevelPrefs();
    expect(zeroGexDisplay.get()).toBe('line');
  });
});

describe('Sigma level', () => {
  const step = (side: 1 | -1, n: 1 | 2 | 3, strike: number): SigmaLevel => ({ side, n, strike, price: strike });
  const withSigma = levels({
    spot: 100,
    sigma: {
      pct: [step(1, 1, 101), step(1, 2, 102), step(1, 3, 102), step(-1, 1, 99), step(-1, 2, 98), step(-1, 3, 97)],
      stat: [step(1, 1, 105), step(1, 2, 110), step(1, 3, 115), step(-1, 1, 95), step(-1, 2, 90), step(-1, 3, 85)],
      statBasis: { expiration: '2099-01-15', iv: 0.2, days: 30, move: 5 },
    },
  });

  test('it is OFF by default (charts and Levels table), on in the panel only after a click; reset turns it off again', () => {
    resetLevelPrefs();
    expect(DEFAULT_OFF_LEVELS).toContain('sigma');
    expect(DEFAULT_SELECTED_LEVELS).not.toContain('sigma');
    expect(getLevelPrefs().selected).not.toContain('sigma');
    toggleLevel('sigma');
    expect(getLevelPrefs().selected).toContain('sigma');
    resetLevelPrefs();
    expect(getLevelPrefs().selected).not.toContain('sigma');
  });

  test('its chip sits at spot (the centre of the ladder), none without Sigma data', () => {
    const keys = levelPanelOrder(withSigma).map((e) => e.key);
    expect(levelPanelOrder(withSigma).find((e) => e.key === 'sigma')?.value).toBe(100);
    expect(keys.indexOf('sigma')).toBe(keys.indexOf('spot') + 1);
    expect(levelPanelOrder(levels({ sigma: null })).find((e) => e.key === 'sigma')?.value).toBeNull();
  });

  test('sigmaLines: the chosen mode, highest strike first, two steps on one strike ordered 2σ before 3σ', () => {
    expect(sigmaLines(withSigma, 'pct').map((l) => [l.key, l.strike, l.text])).toEqual([
      ['sigma:+2', 102, '2σ'], ['sigma:+3', 102, '3σ'], ['sigma:+1', 101, '1σ'], ['sigma:-1', 99, '1σ'], ['sigma:-2', 98, '2σ'], ['sigma:-3', 97, '3σ'],
    ]);
    expect(sigmaLines(withSigma, 'stat').map((l) => l.strike)).toEqual([115, 110, 105, 95, 90, 85]);
    expect(sigmaLines(levels({ sigma: { pct: [], stat: null, statBasis: null } }), 'stat')).toEqual([]);
    expect(sigmaLines(null, 'pct')).toEqual([]);
  });

  test('its % / statistical switch starts on % and Reset brings % back', () => {
    resetLevelPrefs();
    expect(sigmaMode.get()).toBe('pct');
    sigmaMode.set('stat');
    resetLevelPrefs();
    expect(sigmaMode.get()).toBe('pct');
  });
});

describe('gammaFlipUnavailableText', () => {
  const tr = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ''}`;
  test('one text per reason, empty when the flip is shown', () => {
    expect(gammaFlipUnavailableText({ gammaFlipUnavailable: 'futuresPriced', gammaFlipIvCoverage: null } as GexLevels, tr)).toBe('gex.level.tooltip.gammaFlipFutures');
    expect(gammaFlipUnavailableText({ gammaFlipUnavailable: 'ivCoverage', gammaFlipIvCoverage: 0.42 } as GexLevels, tr)).toBe('gex.level.tooltip.gammaFlipNoIv{"pct":"42%"}');
    expect(gammaFlipUnavailableText({ gammaFlipUnavailable: null, gammaFlipIvCoverage: 1 } as GexLevels, tr)).toBe('');
    expect(gammaFlipUnavailableText(null, tr)).toBe('');
  });
});

describe('levelLabelItems', () => {
  const levels = { maxNetGex: 105, minNetGex: 95, gammaFlip: 101.3, spot: 100.2, maxAbsGamma: 105, maxPain: null, sigma: null } as unknown as GexLevels;
  const colors = { ...getLevelPrefs().colors, maxNetGex: '#0f0', minNetGex: '#f00' };
  test('the selected levels with a price, Max AG only with the AG metric, then the visible custom levels', () => {
    const items = levelLabelItems({ levels, selected: ['maxNetGex', 'minNetGex', 'gammaFlip', 'maxAbsGamma', 'maxPain', 'spot'], colors, showMaxAg: false, sigma: 'pct', label: (k) => k.toUpperCase(),
      customLevels: [{ id: 'a', name: 'Mine', price: 99, color: '#123456' }, { id: 'b', name: 'Hidden', price: 98, color: '#123456', hidden: true }] });
    expect(items.map((i) => [i.key, i.value, i.text])).toEqual([['maxNetGex', 105, 'MAXNETGEX'], ['gammaFlip', 101.3, 'GAMMAFLIP'], ['minNetGex', 95, 'MINNETGEX'], ['spot', 100.2, 'SPOT'], ['custom:a', 99, 'Mine']]);
    expect(items[0].color).toBe('#0f0');
    expect(levelLabelItems({ levels, selected: ['maxAbsGamma'], colors, showMaxAg: true, sigma: 'pct', label: (k) => k }).map((i) => i.key)).toEqual(['maxAbsGamma']);
  });
});

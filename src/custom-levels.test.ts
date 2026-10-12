/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { isApplePlatform, isHexColor, LEVEL_PALETTE, levelColorOf, nearestStrike, nextLevelName, parseCustomLevels, proposeLevelColor, roundPrice } from './custom-levels';

const named = (...names: string[]) => names.map((name) => ({ name }));

describe('nextLevelName', () => {
  test('Level 1 when there are no levels', () => {
    expect(nextLevelName([])).toBe('Level 1');
  });

  test('Level 2 when Level 1 exists, Level 3 when 1 and 2 exist', () => {
    expect(nextLevelName(named('Level 1'))).toBe('Level 2');
    expect(nextLevelName(named('Level 1', 'Level 2'))).toBe('Level 3');
  });

  test('a free smaller number is reused', () => {
    expect(nextLevelName(named('Level 2', 'Level 3'))).toBe('Level 1');
  });

  test('custom names do not count, matching is case-insensitive and ignores outer spaces', () => {
    expect(nextLevelName(named('Support', 'my wall'))).toBe('Level 1');
    expect(nextLevelName(named(' level 1 '))).toBe('Level 2');
  });

  test('uses the given (translated) prefix', () => {
    expect(nextLevelName(named('Уровень 1'), 'Уровень')).toBe('Уровень 2');
  });
});

describe('roundPrice', () => {
  test('keeps cents', () => {
    expect(roundPrice(512.3478)).toBe(512.35);
    expect(roundPrice(7811)).toBe(7811);
  });
});

describe('parseCustomLevels', () => {
  test('reads a stored list', () => {
    expect(parseCustomLevels('[{"id":"a","name":"Level 1","price":500.5}]')).toEqual([{ id: 'a', name: 'Level 1', price: 500.5 }]);
  });

  test('missing, broken and wrong-shaped values give an empty list, bad entries are dropped', () => {
    expect(parseCustomLevels(null)).toEqual([]);
    expect(parseCustomLevels('{oops')).toEqual([]);
    expect(parseCustomLevels('{"a":1}')).toEqual([]);
    expect(parseCustomLevels('[{"id":"a","name":"x","price":"5"},null,{"id":"b","name":"ok","price":1}]')).toEqual([{ id: 'b', name: 'ok', price: 1 }]);
  });
});

describe('isApplePlatform', () => {
  test('macOS and iOS are Apple, Windows and Linux are not', () => {
    expect(isApplePlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
    expect(isApplePlatform({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: 'macOS' }, platform: '' })).toBe(true);
    expect(isApplePlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
    expect(isApplePlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: 'Windows' }, platform: 'Win32' })).toBe(false);
  });

  test('no navigator (tests, SSR) is not Apple', () => {
    expect(isApplePlatform(null)).toBe(false);
  });
});

describe('nearestStrike', () => {
  const strikes = [7500, 7510, 7520, 7550, 7600];
  test('picks the closest strike, never a price between two', () => {
    expect(nearestStrike(7512.4, strikes)).toBe(7510);
    expect(nearestStrike(7516, strikes)).toBe(7520);
    expect(nearestStrike(7535, strikes)).toBe(7520); // exactly between 7520 and 7550 is 7535: the lower one wins
    expect(nearestStrike(7536, strikes)).toBe(7550);
  });
  test('an exact strike stays, far outside the range gives the edge strike', () => {
    expect(nearestStrike(7550, strikes)).toBe(7550);
    expect(nearestStrike(100, strikes)).toBe(7500);
    expect(nearestStrike(9000, strikes)).toBe(7600);
  });
  test('works on an unsorted list and with nothing to pick from', () => {
    expect(nearestStrike(7516, [7600, 7500, 7520, 7510])).toBe(7520);
    expect(nearestStrike(7515, [7600, 7500, 7520, 7510])).toBe(7510); // exactly between: the lower one
    expect(nearestStrike(7515, [])).toBeNull();
    expect(nearestStrike(7515, [NaN])).toBeNull();
  });
});

describe('custom level colours', () => {
  test('a level keeps its colour and its hidden flag through save and load, bad values are dropped', () => {
    const levels = parseCustomLevels(JSON.stringify([
      { id: 'a', name: 'A', price: 1, color: '#38bdf8', hidden: true },
      { id: 'b', name: 'B', price: 2, color: 'red', hidden: 'yes' },
      { id: 'c', name: 'C', price: 3 },
    ]));
    expect(levels).toEqual([{ id: 'a', name: 'A', price: 1, color: '#38bdf8', hidden: true }, { id: 'b', name: 'B', price: 2 }, { id: 'c', name: 'C', price: 3 }]);
  });

  test('a level saved before colours existed gets the first palette colour', () => {
    expect(levelColorOf({})).toBe(LEVEL_PALETTE[0]);
    expect(levelColorOf({ color: '#ff0000' })).toBe('#ff0000');
    expect(levelColorOf({ color: 'nope' })).toBe(LEVEL_PALETTE[0]);
  });

  test('the proposal is random among the colours not used yet', () => {
    const used = LEVEL_PALETTE.slice(0, 8).map((color) => ({ color }));
    expect([0, 0.4, 0.99].map((r) => proposeLevelColor(used, () => r))).toEqual([LEVEL_PALETTE[8], LEVEL_PALETTE[8], LEVEL_PALETTE[9]]);
    expect(proposeLevelColor([], () => 0)).toBe(LEVEL_PALETTE[0]);
    expect(proposeLevelColor([], () => 0.999)).toBe(LEVEL_PALETTE[LEVEL_PALETTE.length - 1]);
  });

  test('when every colour is taken any palette colour may come back, and the proposal is always a palette colour', () => {
    const all = LEVEL_PALETTE.map((color) => ({ color }));
    for (const r of [0, 0.3, 0.7, 0.999]) expect(LEVEL_PALETTE).toContain(proposeLevelColor(all, () => r));
    for (let i = 0; i < 50; i++) expect(isHexColor(proposeLevelColor([]))).toBe(true);
  });

  test('palette colours are valid and none repeats', () => {
    expect(LEVEL_PALETTE.every(isHexColor)).toBe(true);
    expect(new Set(LEVEL_PALETTE).size).toBe(LEVEL_PALETTE.length);
  });
});

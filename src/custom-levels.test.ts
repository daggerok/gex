/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { BELOW_SPOT_COLORS, defaultLevelName, isApplePlatform, isHexColor, LEVEL_PALETTE, NEUTRAL_COLORS, ABOVE_SPOT_COLORS, levelColorOf, nearestStrike, nextLevelName, parseCustomLevels, proposeLevelColor, roundPrice } from './custom-levels';

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

  test('a level above the current price starts greenish, below it reddish', () => {
    for (const r of [0, 0.4, 0.99]) {
      expect(ABOVE_SPOT_COLORS).toContain(proposeLevelColor([], 790, 778.57, () => r) as never);
      expect(BELOW_SPOT_COLORS).toContain(proposeLevelColor([], 770, 778.57, () => r) as never);
    }
  });

  test('at the current price, or with no price known, a neutral colour', () => {
    expect(NEUTRAL_COLORS).toContain(proposeLevelColor([], 778.57, 778.57, () => 0.5) as never);
    expect(NEUTRAL_COLORS).toContain(proposeLevelColor([], 790, null, () => 0.5) as never);
    expect(NEUTRAL_COLORS).toContain(proposeLevelColor([], 790, undefined, () => 0.5) as never);
    expect(NEUTRAL_COLORS).toContain(proposeLevelColor([], 790, NaN, () => 0.5) as never);
  });

  test('inside its kind it is random among the colours the other levels do not use yet', () => {
    const used = ABOVE_SPOT_COLORS.slice(0, 2).map((color) => ({ color }));
    expect([0, 0.5, 0.99].map((r) => proposeLevelColor(used, 790, 778, () => r))).toEqual([ABOVE_SPOT_COLORS[2], ABOVE_SPOT_COLORS[2], ABOVE_SPOT_COLORS[2]]);
    expect(proposeLevelColor([], 790, 778, () => 0)).toBe(ABOVE_SPOT_COLORS[0]);
    expect(proposeLevelColor([], 790, 778, () => 0.999)).toBe(ABOVE_SPOT_COLORS[ABOVE_SPOT_COLORS.length - 1]);
    // a colour of the other kind used by another level does not matter
    expect(proposeLevelColor(BELOW_SPOT_COLORS.map((color) => ({ color })), 790, 778, () => 0)).toBe(ABOVE_SPOT_COLORS[0]);
  });

  test('when every colour of the kind is taken, any of that kind may come back', () => {
    const all = ABOVE_SPOT_COLORS.map((color) => ({ color }));
    for (const r of [0, 0.3, 0.7, 0.999]) expect(ABOVE_SPOT_COLORS).toContain(proposeLevelColor(all, 790, 778, () => r) as never);
  });

  test('the proposal is always a palette colour', () => {
    for (let i = 0; i < 60; i++) {
      for (const [price, spot] of [[790, 778], [770, 778], [778, 778], [790, null]] as const) expect(LEVEL_PALETTE).toContain(proposeLevelColor([], price, spot) as never);
    }
  });

  test('palette colours are valid and none repeats', () => {
    expect(LEVEL_PALETTE.every(isHexColor)).toBe(true);
    expect(new Set(LEVEL_PALETTE).size).toBe(LEVEL_PALETTE.length);
  });
});

describe('defaultLevelName', () => {
  const names = { above: 'Buyside', below: 'Sellside', plain: 'Level' };
  const named = (...n: string[]) => n.map((name) => ({ name }));

  test('above the price Buyside, below it Sellside', () => {
    expect(defaultLevelName([], 110, 100, names)).toBe('Buyside');
    expect(defaultLevelName([], 90, 100, names)).toBe('Sellside');
  });

  test('a taken name gets the smallest free number, the two sides count separately, case does not matter', () => {
    expect(defaultLevelName(named('Buyside'), 110, 100, names)).toBe('Buyside 2');
    expect(defaultLevelName(named('Buyside', 'Buyside 2'), 120, 100, names)).toBe('Buyside 3');
    expect(defaultLevelName(named('buyside', 'Buyside 3'), 120, 100, names)).toBe('Buyside 2');
    expect(defaultLevelName(named('Buyside'), 90, 100, names)).toBe('Sellside');
    expect(defaultLevelName(named('Sellside', 'Renamed'), 90, 100, names)).toBe('Sellside 2');
  });

  test('exactly at the price, or without a price, it is a plain numbered Level', () => {
    expect(defaultLevelName([], 100, 100, names)).toBe('Level 1');
    expect(defaultLevelName(named('Level 1'), 100, 100, names)).toBe('Level 2');
    expect(defaultLevelName([], 110, null, names)).toBe('Level 1');
    expect(defaultLevelName([], 110, undefined, names)).toBe('Level 1');
    expect(defaultLevelName([], 110, NaN, names)).toBe('Level 1');
  });

  test('words of another language are used as given', () => {
    expect(defaultLevelName([], 110, 100, { above: 'Покупатели', below: 'Продавцы', plain: 'Уровень' })).toBe('Покупатели');
  });
});

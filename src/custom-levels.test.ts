/// <reference types="node" />
/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { isApplePlatform, nearestStrike, nextLevelName, parseCustomLevels, roundPrice } from './custom-levels';

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

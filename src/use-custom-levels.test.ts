/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CustomLevel } from './custom-levels';
import { customLevelsLocked, customLevelsStorageChanged, ownCustomLevels, readCustomLevels, setCustomLevels, setCustomLevelsOverride } from './use-custom-levels';

const mem = new Map<string, string>();
const level = (id: string, price: number): CustomLevel => ({ id, name: id, price });

beforeEach(() => {
  mem.clear();
  (globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };
});
afterEach(() => setCustomLevelsOverride(null));

describe('custom levels override (backtest)', () => {
  test('the user\'s own levels are shown and saved when nothing is open', () => {
    setCustomLevels('USER1', [level('a', 10)]);
    expect(readCustomLevels('USER1')).toEqual([level('a', 10)]);
    expect(customLevelsLocked()).toBe(false);
  });

  test('a snapshot\'s levels replace them, a ticker without levels in it shows none, and editing is locked', () => {
    setCustomLevels('USER2', [level('own', 1)]);
    setCustomLevelsOverride({ SPY: [level('snap', 99)] });
    expect(customLevelsLocked()).toBe(true);
    expect(readCustomLevels('SPY')).toEqual([level('snap', 99)]);
    expect(readCustomLevels('USER2')).toEqual([]);
    setCustomLevels('SPY', [level('x', 5)]); // ignored while locked, nothing saved
    expect(readCustomLevels('SPY')).toEqual([level('snap', 99)]);
    expect(mem.has('SPY')).toBe(false);
  });

  test('leaving the snapshot brings the user\'s own levels back untouched', () => {
    setCustomLevels('USER3', [level('own', 1)]);
    setCustomLevelsOverride({ USER3: [level('snap', 2)] });
    setCustomLevels('USER3', [level('lost', 3)]);
    setCustomLevelsOverride(null);
    expect(readCustomLevels('USER3')).toEqual([level('own', 1)]);
  });

  test('ownCustomLevels reads the user\'s own levels even while a snapshot is open, only for tickers that have some', () => {
    setCustomLevels('USER4', [level('own', 1)]);
    setCustomLevelsOverride({ USER4: [level('snap', 2)] });
    expect(ownCustomLevels(['USER4', 'NONE'])).toEqual({ USER4: [level('own', 1)] });
  });
});

describe('custom levels saved in another tab', () => {
  test('the changed symbol is read again, other symbols and other keys keep the cache', () => {
    setCustomLevels('TAB1', [level('a', 1)]);
    setCustomLevels('TAB2', [level('b', 2)]);
    mem.set('gex.customLevels.v1.TAB1', JSON.stringify([level('other', 5)]));
    mem.set('gex.customLevels.v1.TAB2', JSON.stringify([level('other', 6)]));
    customLevelsStorageChanged('gex.levelColors.v1');
    expect(readCustomLevels('TAB1')).toEqual([level('a', 1)]);
    customLevelsStorageChanged('gex.customLevels.v1.TAB1');
    expect(readCustomLevels('TAB1')).toEqual([level('other', 5)]);
    expect(readCustomLevels('TAB2')).toEqual([level('b', 2)]);
  });

  test('a cleared storage drops every cached list', () => {
    setCustomLevels('TAB3', [level('c', 3)]);
    mem.clear();
    customLevelsStorageChanged(null);
    expect(readCustomLevels('TAB3')).toEqual([]);
  });
});

/// <reference types="bun" />
/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { persistedChoice, readChoice } from './persisted-choice';

type MiniStorage = Pick<Storage, 'getItem' | 'setItem'>;
const g = globalThis as unknown as { localStorage?: MiniStorage };
let saved: MiniStorage | undefined;
let store: Record<string, string>;

beforeEach(() => {
    saved = g.localStorage;
    store = {};
    g.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
});
afterEach(() => { g.localStorage = saved; });

describe('readChoice', () => {
    test('the stored value when it is allowed, else the fallback', () => {
        expect(readChoice('k', ['a', 'b'], 'a')).toBe('a');
        store.k = 'b';
        expect(readChoice('k', ['a', 'b'], 'a')).toBe('b');
        store.k = 'old-value';
        expect(readChoice('k', ['a', 'b'], 'a')).toBe('a');
    });

    test('a storage that throws gives the fallback', () => {
        g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        expect(readChoice('k', ['a', 'b'], 'b')).toBe('b');
    });
});

describe('persistedChoice', () => {
    test('set stores the value and a new store reads it back', () => {
        const c = persistedChoice('gex.test.v1', ['net', 'split'] as const, 'net');
        expect(c.get()).toBe('net');
        c.set('split');
        expect(c.get()).toBe('split');
        expect(store['gex.test.v1']).toBe('split');
        expect(persistedChoice('gex.test.v1', ['net', 'split'] as const, 'net').get()).toBe('split');
    });

    test('a value outside the list is ignored', () => {
        const c = persistedChoice('gex.test2.v1', ['line', 'area'], 'line');
        c.set('band' as 'line');
        expect(c.get()).toBe('line');
        expect(store['gex.test2.v1']).toBeUndefined();
    });

    test('a failing storage keeps the choice for the page', () => {
        g.localStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        const c = persistedChoice('gex.test3.v1', ['pct', 'stat'], 'pct');
        c.set('stat');
        expect(c.get()).toBe('stat');
    });
});

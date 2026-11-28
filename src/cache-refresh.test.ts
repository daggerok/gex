/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { CACHE_REFRESH_MS, isNewerCacheFile } from './cache-refresh';

describe('isNewerCacheFile', () => {
    test('a later stamp refreshes, the same or an earlier one does not', () => {
        expect(isNewerCacheFile('2026-11-27T10:00:00-05:00', '2026-11-27T10:04:30-05:00')).toBe(true);
        expect(isNewerCacheFile('2026-11-27T10:00:00-05:00', '2026-11-27T10:00:00-05:00')).toBe(false);
        expect(isNewerCacheFile('2026-11-27T10:04:30-05:00', '2026-11-27T10:00:00-05:00')).toBe(false);
    });
    test('stamps are compared as moments, not as text', () => {
        expect(isNewerCacheFile('2026-11-27T10:00:00-05:00', '2026-11-27T15:00:00Z')).toBe(false); // the same moment
        expect(isNewerCacheFile('2026-11-27T10:00:00-05:00', '2026-11-27T15:00:01Z')).toBe(true);
    });
    test('an unknown stamp on either side keeps the shown data', () => {
        expect(isNewerCacheFile(null, '2026-11-27T10:00:00-05:00')).toBe(false);
        expect(isNewerCacheFile('2026-11-27T10:00:00-05:00', undefined)).toBe(false);
        expect(isNewerCacheFile('not a date', '2026-11-27T10:00:00-05:00')).toBe(false);
    });
    test('the page asks every two minutes', () => {
        expect(CACHE_REFRESH_MS).toBe(120_000);
    });
});

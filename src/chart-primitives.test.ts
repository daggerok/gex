/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { withAlpha } from './chart-primitives';

describe('withAlpha', () => {
    test('a #rrggbb colour becomes rgba with the given alpha', () => {
        expect(withAlpha('#d946ef', 0.18)).toBe('rgba(217, 70, 239, 0.18)');
        expect(withAlpha('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
    });

    test('any other colour string is returned unchanged', () => {
        expect(withAlpha('red', 0.5)).toBe('red');
        expect(withAlpha('#abc', 0.5)).toBe('#abc');
    });
});

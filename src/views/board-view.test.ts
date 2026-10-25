/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { boardColumns, signTint } from './BoardView';

describe('boardColumns: the Metrics chips show or hide Board columns (owner, 2026-10-25)', () => {
    test('the default metrics (Net GEX, AG): Net GEX and Abs GEX with the always-shown columns', () => {
        expect(boardColumns(['netGex', 'absoluteGamma'], 'net')).toEqual(['netGex', 'absGex', 'notionalDelta', 'totalOi', 'totalVolume', 'absGexShare']);
    });

    test('the Abs GEX view of the Net GEX chip: call GEX and put GEX instead of the net', () => {
        expect(boardColumns(['netGex'], 'split')).toEqual(['callGex', 'putGex', 'notionalDelta', 'totalOi', 'totalVolume', 'absGexShare']);
    });

    test('every metric on: OI, volume and the P/C ratio columns next to their totals', () => {
        expect(boardColumns(['netGex', 'absoluteGamma', 'callOi', 'putOi', 'callVolume', 'putVolume', 'pcRatioOi', 'pcRatioVolume'], 'net')).toEqual([
            'netGex', 'absGex', 'notionalDelta', 'totalOi', 'callOi', 'putOi', 'pcOi', 'totalVolume', 'callVolume', 'putVolume', 'pcVolume', 'absGexShare',
        ]);
    });
});

describe('signTint: one tint for a peak row and a runner-up cell (owner 2026-10-25)', () => {
    const colors = { netGexPos: '#22c55e', netGexNeg: '#ef4444' };
    test('by the sign of the row Net GEX, mixed into the opaque table base', () => {
        expect(signTint(5, colors)).toBe('color-mix(in srgb, #22c55e 16%, var(--board-base))');
        expect(signTint(-5, colors)).toBe('color-mix(in srgb, #ef4444 16%, var(--board-base))');
    });
    test('no tint for a zero Net GEX', () => {
        expect(signTint(0, colors)).toBeUndefined();
    });
});

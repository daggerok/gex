/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { boardColumns } from './BoardView';

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

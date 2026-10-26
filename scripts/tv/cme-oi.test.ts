/// <reference types="node" />
/// <reference types="bun" />
// CME open interest cross-check (scripts/tv/cme-oi.ts): trading days, the xlsx parse (a tiny workbook built here in the
// layout of the real daily volume file), the product totals and the download service with a fake FTP. No network.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { buildZip } from '../../src/history-zip';
import { CmeOiService, cmeFileName, parseDailyVolume, recentTradingDays, xlsxSheets } from './cme-oi';

const DIR = join(__dirname, '..', '..', '.temp', `cme-test-${process.pid}`);
mkdirSync(DIR, { recursive: true });
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const enc = new TextEncoder();
/** A two-sheet workbook like CME's: a summary sheet, then the products (shared strings, a numeric cell, an entity). */
function workbook(): Uint8Array {
    const strings = ['CME Group Volume and OI by Product', 'Description', 'Commodity Indicator', 'Product Description', 'Future/Option Indicator', 'Open&#x0A;Interest ②',
        'EQUITY INDEX', 'E4A', 'E-MINI S&amp;P 500 MONDAY WEEKLY PUT', 'O', 'ES', 'E-MINI S&amp;P 500 FUTURE', 'F', 'E-MINI S&amp;P 500 CALL', 'EW4', 'EOW4 MINI S&amp;P PUT'];
    const sst = `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;
    const s = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
    const n = (ref: string, v: string) => `<c r="${ref}"><v>${v}</v></c>`;
    const row = (r: number, cells: string) => `<row r="${r}">${cells}</row>`;
    const sheet2 = `<worksheet><sheetData>${[
        row(1, s('A1', 0)),
        row(3, s('A3', 1) + s('C3', 2) + s('D3', 3) + s('E3', 4) + s('F3', 5)),
        row(4, s('A4', 6) + s('C4', 7) + s('D4', 8) + s('E4', 9) + n('F4', '242588')),
        row(5, s('A5', 6) + s('C5', 10) + s('D5', 11) + s('E5', 12) + n('F5', '1.960752e6')),
        row(6, s('A6', 6) + s('C6', 10) + s('D6', 13) + s('E6', 9) + n('F6', '471312')),
        row(7, s('A7', 6) + s('C7', 14) + s('D7', 15) + s('E7', 9) + n('F7', '573771')),
    ].join('')}</sheetData></worksheet>`;
    const sheet1 = `<worksheet><sheetData>${row(1, s('A1', 0))}</sheetData></worksheet>`;
    return buildZip([
        { name: 'xl/sharedStrings.xml', data: enc.encode(sst) },
        { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet1) },
        { name: 'xl/worksheets/sheet2.xml', data: enc.encode(sheet2) },
    ], '2026-10-22', (d) => new Uint8Array(deflateRawSync(d)));
}

describe('CME daily volume file', () => {
    test('trading days before now (New York), weekends skipped; file names', () => {
        expect(recentTradingDays(new Date('2026-10-26T05:00:00Z'), 3)).toEqual(['2026-10-23', '2026-10-22', '2026-10-21']);
        expect(recentTradingDays(new Date('2026-10-27T15:00:00Z'), 2)).toEqual(['2026-10-26', '2026-10-23']);
        expect(cmeFileName('2026-10-22')).toBe('daily_volume_20261022.xlsx');
    });

    test('the product sheet: option rows by code and side, futures left out, entities and exponents read', () => {
        const sheets = xlsxSheets(Buffer.from(workbook()));
        expect(sheets).toHaveLength(2);
        const oi = parseDailyVolume(sheets, '2026-10-22', 'f');
        expect(oi.products).toEqual({ 'E4A|put': 242588, 'ES|call': 471312, 'EW4|put': 573771 });
        expect(() => parseDailyVolume([[['nothing']]], 'd', 'f')).toThrow('no sheet');
    });

    test('the service downloads the newest posted day once (550 = not posted yet), caches it, and waits after an error', async () => {
        const asked: string[] = [];
        const svc = new CmeOiService(() => {}, DIR, async (path) => {
            asked.push(path);
            if (path.endsWith('20261023.xlsx')) throw new Error('ftp ftp.cmegroup.com: 550 Failed to open file.');
            return Buffer.from(workbook());
        });
        await svc.refresh(new Date('2026-10-26T05:00:00Z'));
        expect(asked).toEqual(['/daily_volume/daily_volume_20261023.xlsx', '/daily_volume/daily_volume_20261022.xlsx']);
        expect(svc.get(new Date('2026-10-26T05:00:00Z'))?.day).toBe('2026-10-22');
        expect(readdirSync(DIR)).toEqual(['daily_volume_20261022.xlsx']);
        // within the retry interval: no new request even though Friday's file is still missing
        await svc.refresh(new Date('2026-10-26T05:00:00Z'));
        expect(asked).toHaveLength(2);
        // a new process reads the cached file without a download
        const again = new CmeOiService(() => {}, DIR, async () => { throw new Error('no network'); });
        expect(again.get(new Date('2026-10-26T05:00:00Z'))?.products['E4A|put']).toBe(242588);
    });
});

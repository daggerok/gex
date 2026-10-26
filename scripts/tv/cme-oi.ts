/// <reference types="node" />
/// <reference types="bun" />
/**
 * CME open interest cross-check of the TradingView futures chains (owner 2026-10-26). README: "Local proxy and TradingView
 * live mode" -> "CME open interest cross-check"; research: workspace reports/cme-open-interest-research.md.
 *
 * TradingView keeps each option's OI of the last day it changed; CME publishes, free on its anonymous FTP, the preliminary
 * open interest per option PRODUCT and side (not per strike): ftp://ftp.cmegroup.com/daily_volume/daily_volume_YYYYMMDD.xlsx,
 * about 100 KB, posted about 03:31 CT the next morning. The proxy downloads the newest file when it is missing (on start and
 * when a page asks for a futures ticker, at most once per CME_RETRY_MS while it is missing), keeps it locally in
 * api/futures/cme/ (gitignored, never published), parses it with node built-ins (zip + XML) and serves the totals:
 *
 *   GET /api/futures/cme-oi   {"day":"2026-10-23","file":"daily_volume_20261023.xlsx","products":{"E4A|put":242588,...}}
 *
 * The app compares them with the summed OI of its chain per product and side (src/oi-dates.ts cmeOiLag). Only the FTP:
 * www.cmegroup.com forbids scripts in its terms and blocks non-browser clients, it is never contacted.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { FUTURES_DIR } from './chain';

export const CME_FTP_HOST = 'ftp.cmegroup.com';
export const CME_DIR = join(FUTURES_DIR, 'cme');
/** A missing file is looked for again at most this often. */
export const CME_RETRY_MS = 60 * 60_000;
/** How many trading days back a download tries (the newest posted file wins). */
export const CME_LOOKBACK_DAYS = 5;

/** "2026-10-23" -> "daily_volume_20261023.xlsx" */
export function cmeFileName(day: string): string {
    return `daily_volume_${day.replace(/-/g, '')}.xlsx`;
}

/** The weekdays before `now` (New York calendar), newest first: the trading days whose file may be posted. */
export function recentTradingDays(now: Date, count: number = CME_LOOKBACK_DAYS): string[] {
    const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const d = new Date(`${ny}T12:00:00Z`);
    const out: string[] = [];
    while (out.length < count) {
        d.setUTCDate(d.getUTCDate() - 1);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

// ---- xlsx (zip + XML) with built-ins ----------------------------------------------------------------------------------

/** The files of a zip by name (stored or deflated entries, from the central directory). */
export function unzip(buf: Buffer): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const entries = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let k = 0; k < entries; k++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
        const method = buf.readUInt16LE(p + 10);
        const size = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
        const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(dataAt, dataAt + size);
        out.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : Buffer.alloc(0));
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

const xmlText = (s: string): string => s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The rows of every sheet (in order) as arrays of cell texts (shared strings resolved, empty cells kept by column letter). */
export function xlsxSheets(buf: Buffer): string[][][] {
    const files = unzip(buf);
    const shared: string[] = [];
    const ss = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(xmlText((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    const names = Array.from(files.keys()).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
    return names.map((n) => sheetRows(files.get(n)!.toString('utf8'), shared));
}

function sheetRows(sheet: string, shared: readonly string[]): string[][] {
    const col = (ref: string) => ref.replace(/\d+/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows: string[][] = [];
    for (const row of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
        const cells: string[] = [];
        for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
            const ref = /r="([A-Z]+)\d+"/.exec(c)?.[1];
            const type = /t="(\w+)"/.exec(c)?.[1];
            const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1] ?? '';
            const text = type === 's' ? shared[Number(v)] ?? '' : xmlText(v);
            cells[ref ? col(ref) : cells.length] = text;
        }
        rows.push(Array.from(cells, (x) => x ?? ''));
    }
    return rows;
}

export interface CmeOi {
    /** the trading day of the file */
    day: string;
    file: string;
    /** preliminary open interest of option products by "<code>|<call|put>" */
    products: Record<string, number>;
}

/**
 * The option rows of a daily volume file (the sheet whose header names a commodity code and the open interest; the first
 * sheet is a summary by asset class): code, side (from the description), open interest.
 */
export function parseDailyVolume(sheets: readonly string[][][], day: string, file: string): CmeOi {
    const isHead = (r: readonly string[]) => r.some((c) => /commodity|code/i.test(c)) && r.some((c) => /open\s*interest/i.test(c));
    const rows = sheets.find((sh) => sh.some(isHead));
    if (!rows) throw new Error('no sheet with a commodity code and an open interest column');
    const head = rows.findIndex(isHead);
    // headers seen 2026-10-26: Description (asset class) | Exchange Name | Commodity Indicator | Product Description |
    // Future/Option Indicator | ...volumes... | Open\nInterest
    const h = rows[head].map((c) => c.toLowerCase().replace(/\s+/g, ' ').trim());
    const find = (re: RegExp) => h.findIndex((c) => re.test(c));
    const iCode = find(/commodity|\bcode\b/);
    const iDesc = find(/product description/) >= 0 ? find(/product description/) : find(/description/);
    const iFo = find(/future\/option|^f\/o$/);
    const iOi = find(/open interest/);
    const products: Record<string, number> = {};
    for (const r of rows.slice(head + 1)) {
        const code = (r[iCode] ?? '').trim().toUpperCase();
        const desc = (r[iDesc] ?? '').toUpperCase();
        const oi = Number(String(r[iOi] ?? '').replace(/,/g, ''));
        if (!code || !Number.isFinite(oi)) continue;
        if (iFo >= 0 && (r[iFo] ?? '').trim().toUpperCase() !== 'O') continue;
        const side = /\bPUTS?\b/.test(desc) ? 'put' : /\bCALLS?\b/.test(desc) ? 'call' : null;
        if (!side) continue;
        const key = `${code}|${side}`;
        products[key] = (products[key] ?? 0) + oi;
    }
    return { day, file, products };
}

// ---- anonymous FTP (passive mode, binary) -----------------------------------------------------------------------------

/** One file from an anonymous FTP server; rejects with the server's line on an error (550 = no such file). */
export function ftpGet(host: string, path: string, timeoutMs = 30_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ctl: Socket = connect(21, host);
        let buf = '';
        let data: Socket | null = null;
        const chunks: Buffer[] = [];
        let dataDone = false;
        let transferOk = false;
        const timer = setTimeout(() => fail(new Error(`ftp ${host}: timeout`)), timeoutMs);
        const finish = () => {
            if (!dataDone || !transferOk) return;
            clearTimeout(timer);
            ctl.end('QUIT\r\n');
            resolve(Buffer.concat(chunks));
        };
        function fail(err: Error) {
            clearTimeout(timer);
            data?.destroy();
            ctl.destroy();
            reject(err);
        }
        const send = (line: string) => ctl.write(`${line}\r\n`);
        ctl.on('error', fail);
        ctl.on('data', (d) => {
            buf += d.toString('latin1');
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                if (!/^\d{3}(?:\s|$)/.test(line)) continue; // "220-..." continuation lines; the last one may be a bare "220 "
                const code = Number(line.slice(0, 3));
                if (code === 220) send('USER anonymous');
                else if (code === 331) send('PASS gex@localhost');
                else if (code === 230) send('TYPE I');
                else if (code === 200) send('PASV');
                else if (code === 227) {
                    const m = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(line);
                    if (!m) return fail(new Error(`ftp ${host}: bad PASV answer`));
                    data = connect(Number(m[5]) * 256 + Number(m[6]), `${m[1]}.${m[2]}.${m[3]}.${m[4]}`);
                    data.on('data', (c: Buffer) => chunks.push(c));
                    data.on('end', () => { dataDone = true; finish(); });
                    data.on('error', fail);
                    send(`RETR ${path}`);
                } else if (code === 150 || code === 125) {
                    // transfer starting
                } else if (code === 226) {
                    transferOk = true;
                    finish();
                } else if (code === 221) {
                    // bye
                } else if (code >= 400) fail(new Error(`ftp ${host}: ${line}`));
            }
        });
    });
}

// ---- the cache and the service of the proxy ---------------------------------------------------------------------------

/** The newest daily volume file already on disk, parsed; null when none. */
export function readCachedCmeOi(dir: string = CME_DIR): CmeOi | null {
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => /^daily_volume_\d{8}\.xlsx$/.test(f)).sort();
    const file = files[files.length - 1];
    if (!file) return null;
    const ymd = file.slice(13, 21);
    const day = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    try {
        return parseDailyVolume(xlsxSheets(readFileSync(join(dir, file))), day, file);
    } catch {
        return null;
    }
}

/**
 * The CME totals for the proxy: the newest file on disk, and a download of a newer one when the newest trading day's file
 * is not there yet (at most once per CME_RETRY_MS). `get` is cheap after the first parse.
 */
export class CmeOiService {
    private cached: CmeOi | null = null;
    private lastTry = 0;
    private running: Promise<void> | null = null;

    constructor(
        private readonly log: (line: string) => void = (l) => console.log(`CME    | ${l}`),
        private readonly dir: string = CME_DIR,
        private readonly download: (path: string) => Promise<Buffer> = (path) => ftpGet(CME_FTP_HOST, path),
    ) {}

    /** The totals now (the cache), and a background refresh when a newer trading day may be posted. */
    get(now: Date = new Date()): CmeOi | null {
        if (!this.cached) this.cached = readCachedCmeOi(this.dir);
        void this.refresh(now);
        return this.cached;
    }

    /** Download the newest posted file when the newest trading day's one is missing. */
    refresh(now: Date = new Date()): Promise<void> {
        if (this.running) return this.running;
        const newest = recentTradingDays(now, 1)[0];
        if (this.cached?.day === newest || Date.now() - this.lastTry < CME_RETRY_MS) return Promise.resolve();
        this.lastTry = Date.now();
        this.running = (async () => {
            for (const day of recentTradingDays(now)) {
                if (this.cached && day <= this.cached.day) break;
                const file = cmeFileName(day);
                try {
                    const buf = await this.download(`/daily_volume/${file}`);
                    const oi = parseDailyVolume(xlsxSheets(buf), day, file);
                    mkdirSync(this.dir, { recursive: true });
                    writeFileSync(join(this.dir, `${file}.tmp`), buf);
                    renameSync(join(this.dir, `${file}.tmp`), join(this.dir, file));
                    this.cached = oi;
                    this.log(`downloaded ${file} (${Object.keys(oi.products).length} option products and sides)`);
                    return;
                } catch (err) {
                    const msg = (err as Error).message;
                    if (!/550/.test(msg)) {
                        this.log(`${file}: ${msg} (next try in ${CME_RETRY_MS / 60_000} min)`);
                        return;
                    }
                    // not posted (yet): try the trading day before
                }
            }
        })().finally(() => { this.running = null; });
        return this.running;
    }
}

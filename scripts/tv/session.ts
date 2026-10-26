#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * bun run tv:session - put the TradingView session cookies into ~/.config/gex/tradingview.env (mode 600). On the owner's machine only, the value is never printed.
 *
 * 1. Import `sessionid` and `sessionid_sign` of .tradingview.com from the owner's Chrome profiles on macOS: each Cookies
 *    sqlite is read into memory (never copied to disk), the AES key comes from the Keychain item "Chrome Safe Storage"
 *    (macOS asks once for access), values are v10 = AES-128-CBC with PBKDF2-SHA1(password, "saltysalt", 1003, 16) and an
 *    IV of 16 spaces. Chrome 130+ (cookie db meta version >= 24) prefixes the plaintext with SHA-256(host_key): stripped.
 *    The profile whose sessionid was used most recently wins
 * 2. Fallback: a hidden-input prompt (nothing is echoed)
 *
 * Flags: --probe    list the profiles that hold a TradingView session (names and dates only, no Keychain, no values)
 *        --prompt   skip Chrome and ask
 *        --dry-run  do everything except writing the file
 * Never prints, logs or writes the values anywhere but the env file. Next step: bun run tv:check
 */
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Database } from 'bun:sqlite';
import { parseEnv, TV_ENV_PATH } from './env';

const CHROME_DIR = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
const HOST_KEYS = ['.tradingview.com', 'www.tradingview.com', 'tradingview.com'];
/** Chrome stores times as microseconds since 1601-01-01; this many ms lie between 1601-01-01 and 1970-01-01. */
const CHROME_EPOCH_OFFSET_MS = 11644473600000;

interface CookieRow {
    host_key: string;
    name: string;
    encrypted_value: Uint8Array;
    value: string;
    last_access_utc: number | bigint;
}

interface ProfileHit {
    profile: string;
    dbVersion: number;
    rows: CookieRow[];
    lastAccess: Date;
}

/** A Chrome timestamp (microseconds since 1601) as a Date; 0 = never. Microsecond precision is not needed here. */
export function chromeTime(t: number | bigint): Date {
    const us = Number(t);
    return us === 0 ? new Date(0) : new Date(us / 1000 - CHROME_EPOCH_OFFSET_MS);
}

/** The TradingView session rows of every Chrome profile, most recently used first. Each database is read from memory. */
export function findProfiles(chromeDir: string = CHROME_DIR): ProfileHit[] {
    if (!existsSync(chromeDir)) return [];
    const hits: ProfileHit[] = [];
    for (const entry of readdirSync(chromeDir)) {
        if (entry !== 'Default' && !entry.startsWith('Profile ')) continue;
        const path = join(chromeDir, entry, 'Cookies');
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        let db: Database | null = null;
        try {
            db = Database.deserialize(readFileSync(path), true);
            const meta = db.query("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | null;
            const placeholders = HOST_KEYS.map(() => '?').join(',');
            const rows = db.query(`SELECT host_key, name, encrypted_value, value, last_access_utc FROM cookies WHERE host_key IN (${placeholders}) AND name IN ('sessionid','sessionid_sign')`)
                .all(...HOST_KEYS) as CookieRow[];
            const sessionRows = rows.filter((r) => r.name === 'sessionid');
            if (!sessionRows.length) continue;
            const lastAccess = sessionRows.map((r) => chromeTime(r.last_access_utc)).sort((a, b) => b.getTime() - a.getTime())[0];
            hits.push({ profile: entry, dbVersion: Number(meta?.value ?? 0), rows, lastAccess });
        } catch (err) {
            console.error(`skip ${entry}: ${(err as Error).message}`);
        } finally {
            db?.close();
        }
    }
    return hits.sort((a, b) => b.lastAccess.getTime() - a.lastAccess.getTime());
}

/** The Keychain password of "Chrome Safe Storage" (macOS shows an Allow dialog the first time). */
async function chromeSafeStoragePassword(): Promise<string> {
    const proc = Bun.spawn(['security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage'], { stdout: 'pipe', stderr: 'pipe' });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`Keychain access to "Chrome Safe Storage" failed (exit ${code})`);
    return out.trim();
}

export function chromeKey(password: string): Buffer {
    return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

/** Decrypt one v10 / v11 cookie value. `dbVersion` >= 24 means a 32-byte SHA-256(host_key) prefix in the plaintext. */
export function decryptChromeCookie(encrypted: Uint8Array, key: Buffer, hostKey: string, dbVersion: number): string {
    const buf = Buffer.from(encrypted);
    const prefix = buf.subarray(0, 3).toString('latin1');
    if (prefix !== 'v10' && prefix !== 'v11') throw new Error(`unsupported cookie encryption "${prefix}"`);
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    let plain = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    if (dbVersion >= 24 && plain.length >= 32) {
        const hash = createHash('sha256').update(hostKey).digest();
        if (plain.subarray(0, 32).equals(hash)) plain = plain.subarray(32);
    }
    return plain.toString('utf8');
}

/** Shape checks: a session id is 20-64 letters and digits, the signature a short token. */
export const SESSIONID_RE = /^[a-z0-9]{20,64}$/i;
export const SESSIONID_SIGN_RE = /^[\w.:+/=-]{8,200}$/;

async function importFromChrome(): Promise<{ sessionid: string; sessionidSign: string | null; profile: string } | null> {
    const hits = findProfiles();
    if (!hits.length) {
        console.log('Chrome: no profile holds a TradingView session');
        return null;
    }
    const hit = hits[0];
    console.log(`Chrome: using "${hit.profile}" (TradingView session last used ${hit.lastAccess.toISOString().slice(0, 10)}); macOS may ask to allow Keychain access`);
    const key = chromeKey(await chromeSafeStoragePassword());
    const pick = (name: string): string | null => {
        const row = hit.rows.filter((r) => r.name === name).sort((a, b) => Number(b.last_access_utc) - Number(a.last_access_utc))[0];
        if (!row) return null;
        return row.value || decryptChromeCookie(row.encrypted_value, key, row.host_key, hit.dbVersion);
    };
    const sessionid = pick('sessionid');
    if (!sessionid || !SESSIONID_RE.test(sessionid)) throw new Error('the decrypted sessionid does not look valid');
    const sign = pick('sessionid_sign');
    return { sessionid, sessionidSign: sign && SESSIONID_SIGN_RE.test(sign) ? sign : null, profile: hit.profile };
}

/** Read a line from the terminal without echoing it. */
async function hiddenPrompt(label: string): Promise<string> {
    process.stdout.write(label);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
        const text = await new Response(Bun.stdin.stream()).text(); // piped input: one line
        return text.split('\n')[0].trim();
    }
    stdin.setRawMode(true);
    stdin.resume();
    return await new Promise<string>((resolve, reject) => {
        let value = '';
        const cleanup = () => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
        };
        const onData = (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === '\r' || ch === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(value.trim());
                    return;
                }
                if (ch === '\u0003') {
                    cleanup();
                    process.stdout.write('\n');
                    reject(new Error('cancelled'));
                    return;
                }
                if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
                else value += ch;
            }
        };
        stdin.on('data', onData);
    });
}

/** Write the env file with mode 600 (atomically: a 600 temp file, then a rename), keeping unrelated keys. */
export function writeEnvFile(values: { sessionid: string; sessionidSign: string | null }, path: string = TV_ENV_PATH): void {
    const existing = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
    delete existing.TV_SESSIONID;
    delete existing.TV_SESSIONID_SIGN;
    const lines = Object.keys(existing).map((k) => `${k}=${existing[k]}`);
    lines.push(`TV_SESSIONID=${values.sessionid}`);
    if (values.sessionidSign) lines.push(`TV_SESSIONID_SIGN=${values.sessionidSign}`);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.indexOf('--probe') >= 0) {
        const hits = findProfiles();
        if (!hits.length) console.log('no Chrome profile holds a TradingView session');
        for (const h of hits) console.log(`${h.profile}: cookie db v${h.dbVersion}, cookies ${h.rows.map((r) => `${r.name}@${r.host_key}`).join(', ')}, last used ${h.lastAccess.toISOString()}`);
        return;
    }
    let result: { sessionid: string; sessionidSign: string | null; source: string } | null = null;
    if (args.indexOf('--prompt') < 0 && process.platform === 'darwin') {
        try {
            const r = await importFromChrome();
            if (r) result = { sessionid: r.sessionid, sessionidSign: r.sessionidSign, source: `Chrome ${r.profile}` };
        } catch (err) {
            console.log(`Chrome import failed: ${(err as Error).message}. Falling back to the prompt`);
        }
    }
    if (!result) {
        console.log('Open tradingview.com logged in -> DevTools -> Application -> Cookies -> https://www.tradingview.com');
        const sessionid = await hiddenPrompt('sessionid (hidden): ');
        if (!SESSIONID_RE.test(sessionid)) throw new Error('that does not look like a sessionid (20-64 letters and digits)');
        const sign = await hiddenPrompt('sessionid_sign (hidden, Enter to skip): ');
        result = { sessionid, sessionidSign: sign && SESSIONID_SIGN_RE.test(sign) ? sign : null, source: 'prompt' };
    }
    const summary = `sessionid ok (${result.sessionid.length} chars), sessionid_sign ${result.sessionidSign ? `ok (${result.sessionidSign.length} chars)` : 'not found (not needed)'}, source ${result.source}`;
    if (args.indexOf('--dry-run') >= 0) {
        const current = existsSync(TV_ENV_PATH) ? parseEnv(readFileSync(TV_ENV_PATH, 'utf8')) : {};
        const same = current.TV_SESSIONID ? (current.TV_SESSIONID === result.sessionid ? 'same sessionid as the env file' : 'sessionid differs from the env file') : 'no env file yet';
        console.log(`dry run: ${summary}; ${same}; ${TV_ENV_PATH} not written`);
        return;
    }
    writeEnvFile(result);
    console.log(`wrote ${TV_ENV_PATH} (mode 600): ${summary}. Next: bun run tv:check`);
}

if (require.main === module) {
    main().catch((err: unknown) => {
        console.error(`tv:session failed: ${(err as Error).message}`);
        process.exitCode = 1;
    });
}

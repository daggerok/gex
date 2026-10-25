/// <reference types="node" />
/// <reference types="bun" />
/**
 * The owner's TradingView session for the LOCAL-ONLY futures options scripts (tv:session, tv:check, tv:futures).
 * Never imported by scripts/options-data.ts or anything that runs in GitHub Actions (scripts/tv/local-only.test.ts guards it).
 *
 * The session lives in ~/.config/gex/tradingview.env (mode 600): TV_SESSIONID, optional TV_SESSIONID_SIGN. The values and
 * the auth token derived from them are NEVER printed, logged or written anywhere else: run redact() on any text that could
 * echo them before it is printed or saved.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TV_ENV_PATH = join(homedir(), '.config', 'gex', 'tradingview.env');

export interface TvSession {
    sessionid: string;
    sessionidSign: string | null;
}

/** KEY=value lines; `#` comments and blank lines skipped, one level of quotes stripped. */
export function parseEnv(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        out[line.slice(0, eq).trim()] = value;
    }
    return out;
}

/** The session from the environment (TV_SESSIONID wins) or the env file; null when there is none. Read at call time. */
export function loadTvSession(path: string = TV_ENV_PATH): TvSession | null {
    const env = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
    const sessionid = process.env.TV_SESSIONID || env.TV_SESSIONID || '';
    if (!sessionid) return null;
    const sessionidSign = process.env.TV_SESSIONID_SIGN || env.TV_SESSIONID_SIGN || '';
    return { sessionid, sessionidSign: sessionidSign || null };
}

export function cookieHeader(s: TvSession | null): string {
    if (!s) return '';
    const parts = [`sessionid=${s.sessionid}`];
    if (s.sessionidSign) parts.push(`sessionid_sign=${s.sessionidSign}`);
    return parts.join('; ');
}

/** Anything shaped like a JWT (three base64url parts, the first one a JSON header). */
const JWT_RE = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;

/**
 * `text` with every secret replaced by a placeholder: the session values of `s` and any JWT (the auth token). Run it on
 * every message that could echo a request or an answer, before it is printed or saved.
 */
export function redact(text: string, s: TvSession | null = loadTvSession()): string {
    let out = text.replace(JWT_RE, '<REDACTED_JWT>');
    if (!s) return out;
    out = out.split(s.sessionid).join('<REDACTED_SESSIONID>');
    if (s.sessionidSign) out = out.split(s.sessionidSign).join('<REDACTED_SESSIONID_SIGN>');
    return out;
}

/** The `exp` claim of a JWT as epoch ms, null when it cannot be read. Only the claim is decoded, nothing is printed. */
export function jwtExpiresAt(token: string | null | undefined): number | null {
    const part = String(token ?? '').split('.')[1];
    if (!part) return null;
    try {
        const json = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
        return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp * 1000 : null;
    } catch {
        return null;
    }
}

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

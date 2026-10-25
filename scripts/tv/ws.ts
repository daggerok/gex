/// <reference types="node" />
/// <reference types="bun" />
/**
 * Minimal TradingView realtime websocket client (quote sessions only), LOCAL ONLY.
 * Frames are "~m~<len>~m~<payload>"; heartbeats "~h~N" are echoed back. The auth token (a JWT bound to the session) is a
 * secret: it is sent to TradingView and never printed.
 */
import { cookieHeader, type TvSession, UA } from './env';

/** One protocol message: `m` is the method, `p` its parameters. */
export interface TvMessage {
    m: string;
    p: unknown[];
}

export function encodeFrame(payload: string): string {
    return `~m~${payload.length}~m~${payload}`;
}

/** The payloads of every frame in one websocket message (several frames can arrive glued together). */
export function decodeFrames(data: string): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < data.length) {
        if (!data.startsWith('~m~', i)) break;
        const lenEnd = data.indexOf('~m~', i + 3);
        if (lenEnd < 0) break;
        const len = Number(data.slice(i + 3, lenEnd));
        const start = lenEnd + 3;
        out.push(data.slice(start, start + len));
        i = start + len;
    }
    return out;
}

/** The auth token embedded in the logged-in chart page (`"auth_token":"<JWT>"`), null on an anonymous page. */
export function authTokenFromPage(html: string): string | null {
    return html.match(/"auth_token":"([^"]+)"/)?.[1] ?? null;
}

export interface AuthAnswer {
    token: string | null;
    status: number;
    isPro: boolean | null;
    /** the page names a logged-in user */
    loggedIn: boolean;
}

/** GET tradingview.com/chart/ with the session cookie; the token is null when the session was rejected. */
export async function fetchAuthToken(s: TvSession): Promise<AuthAnswer> {
    const res = await fetch('https://www.tradingview.com/chart/', {
        headers: { 'User-Agent': UA, Cookie: cookieHeader(s), Accept: 'text/html' },
        redirect: 'follow',
    });
    const html = await res.text();
    const pro = html.match(/"is_pro":(true|false)/)?.[1];
    return { token: authTokenFromPage(html), status: res.status, isPro: pro == null ? null : pro === 'true', loggedIn: /"username":"[^"]+"/.test(html) };
}

/** The token TradingView accepts for an anonymous (10 minutes delayed) session. */
export const ANONYMOUS_TOKEN = 'unauthorized_user_token';

export interface WsOptions {
    session: TvSession | null;
    onMessage: (msg: TvMessage) => void;
    /** called once when the socket closes (by either side) */
    onClose?: (reason: string) => void;
}

export class TvSocket {
    private readonly ws: WebSocket;
    readonly opened: Promise<void>;
    closed = false;
    /** messages sent, for the request counts in the logs */
    sent = 0;

    constructor(private readonly opts: WsOptions) {
        const url = `wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=${new Date().toISOString().slice(0, 19)}&type=chart`;
        const headers: Record<string, string> = { Origin: 'https://www.tradingview.com', 'User-Agent': UA };
        if (opts.session) headers.Cookie = cookieHeader(opts.session);
        // Bun accepts headers in the second argument of the WebSocket constructor
        this.ws = new WebSocket(url, { headers } as unknown as string[]);
        this.opened = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', () => resolve());
            this.ws.addEventListener('error', () => reject(new Error('websocket error')));
        });
        // a rejection nobody awaits must not crash the process (the close handler reports it)
        this.opened.catch(() => undefined);
        this.ws.addEventListener('close', (ev) => {
            if (this.closed) return;
            this.closed = true;
            this.opts.onClose?.(`closed (code ${(ev as CloseEvent).code})`);
        });
        this.ws.addEventListener('message', (ev) => {
            for (const payload of decodeFrames(String(ev.data))) {
                if (payload.startsWith('~h~')) {
                    this.ws.send(encodeFrame(payload));
                    continue;
                }
                let msg: unknown;
                try {
                    msg = JSON.parse(payload);
                } catch {
                    continue; // not JSON: ignore
                }
                // the server hello is JSON without `m`
                if (msg && typeof (msg as TvMessage).m === 'string' && Array.isArray((msg as TvMessage).p)) this.opts.onMessage(msg as TvMessage);
            }
        });
    }

    send(m: string, p: unknown[]): void {
        if (this.closed) return;
        this.sent++;
        this.ws.send(encodeFrame(JSON.stringify({ m, p })));
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        try {
            this.ws.close();
        } catch {
            // already closing
        }
    }
}

export function randomId(prefix: string): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = prefix;
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

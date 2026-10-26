/// <reference types="bun" />
/// <reference types="node" />
/**
 * CORS allowlist of the local proxy (scripts/options-local-proxy.ts), batch 4 item 3 (owner 2026-10-25): only the app
 * served from this machine (http or https on localhost or 127.0.0.1, any port) and the published site
 * https://daggerok.github.io may read the proxy from a browser. Any other page gets 403 and no CORS header, so it can
 * neither read the answers nor make the proxy spend the user's Yahoo session. A request with no Origin (curl, the same
 * origin) is served without CORS headers. A separate module so the rule is tested without starting the server.
 */

/** The published site (GitHub Pages), allowed exactly (scheme, host, default port). */
export const ALLOWED_SITE_ORIGINS: readonly string[] = ['https://daggerok.github.io'];
/** Hosts of the local app, allowed on any port over http or https. */
export const ALLOWED_LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

/** True when a browser page of this Origin may use the proxy. */
export function isAllowedOrigin(origin: string): boolean {
    if (ALLOWED_SITE_ORIGINS.includes(origin)) return true;
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false; // "null" (a file:// page or a sandboxed frame) and anything malformed
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // an Origin is only scheme, host and port: a path, credentials or a query mean it is not a real Origin header
    if (url.origin !== origin) return false;
    return ALLOWED_LOCAL_HOSTS.includes(url.hostname);
}

/** What the proxy does with a request: serve it with these extra headers, or refuse it (a page of another origin). */
export type CorsDecision = { allow: true; headers: Record<string, string> } | { allow: false };

const ALLOW_METHODS = 'GET, OPTIONS';
const ALLOW_HEADERS = '*';

/**
 * The CORS answer for a request's Origin header (null = no Origin). `privateNetwork`: the request carries
 * `Access-Control-Request-Private-Network: true`, the preflight Chrome sends before a public page (the published site)
 * may call this machine (Private Network Access; Chrome 142+ Local Network Access asks the user for permission first).
 * Only an allowed origin gets `Access-Control-Allow-Private-Network: true` back (auto proxy opt-in, owner 2026-10-25).
 */
export function corsFor(origin: string | null, privateNetwork = false): CorsDecision {
    if (origin === null) return { allow: true, headers: {} };
    if (!isAllowedOrigin(origin)) return { allow: false };
    const headers: Record<string, string> = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOW_METHODS,
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        Vary: 'Origin',
    };
    if (privateNetwork) headers['Access-Control-Allow-Private-Network'] = 'true';
    return { allow: true, headers };
}

/** True when a request asks for private network access (the PNA preflight header). */
export function asksPrivateNetwork(headers: Pick<Headers, 'get'>): boolean {
    return (headers.get('access-control-request-private-network') ?? '').toLowerCase() === 'true';
}

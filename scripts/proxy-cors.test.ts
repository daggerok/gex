/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { asksPrivateNetwork, corsFor, isAllowedOrigin } from './proxy-cors';

describe('local proxy CORS allowlist (batch 4 item 3, owner 2026-10-25)', () => {
    test('the local app on localhost or 127.0.0.1, any port, http or https', () => {
        for (const o of ['http://localhost:1234', 'http://localhost', 'https://localhost:8443', 'http://127.0.0.1:5173', 'http://127.0.0.1']) {
            expect(isAllowedOrigin(o)).toBe(true);
        }
    });

    test('the published site exactly', () => {
        expect(isAllowedOrigin('https://daggerok.github.io')).toBe(true);
        expect(isAllowedOrigin('http://daggerok.github.io')).toBe(false);
        expect(isAllowedOrigin('https://daggerok.github.io:8443')).toBe(false);
        expect(isAllowedOrigin('https://evil.github.io')).toBe(false);
        expect(isAllowedOrigin('https://daggerok.github.io.evil.com')).toBe(false);
    });

    test('everything else is refused', () => {
        for (const o of ['null', '', 'https://example.com', 'http://localhost.evil.com', 'http://192.168.1.10:1234', 'http://[::1]:1234', 'http://0.0.0.0:1234', 'file://', 'chrome-extension://abc', 'http://localhost:1234/path', 'http://user@localhost:1234']) {
            expect(isAllowedOrigin(o)).toBe(false);
        }
    });

    test('corsFor: an allowed origin is echoed with Vary, a refused one is refused, no Origin gets no CORS headers', () => {
        expect(corsFor('http://localhost:1234')).toEqual({
            allow: true,
            headers: { 'Access-Control-Allow-Origin': 'http://localhost:1234', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', Vary: 'Origin' },
        });
        expect(corsFor('https://example.com')).toEqual({ allow: false });
        expect(corsFor(null)).toEqual({ allow: true, headers: {} });
    });

    test('the private network preflight (published site -> this machine) is answered only for an allowed origin', () => {
        const pna = new Headers({ 'Access-Control-Request-Private-Network': 'true' });
        expect(asksPrivateNetwork(pna)).toBe(true);
        expect(asksPrivateNetwork(new Headers())).toBe(false);
        const site = corsFor('https://daggerok.github.io', true);
        expect(site.allow && site.headers['Access-Control-Allow-Private-Network']).toBe('true');
        expect(site.allow && site.headers['Access-Control-Allow-Origin']).toBe('https://daggerok.github.io');
        const plain = corsFor('https://daggerok.github.io');
        expect(plain.allow && 'Access-Control-Allow-Private-Network' in plain.headers).toBe(false);
        expect(corsFor('https://evil.example', true)).toEqual({ allow: false });
        expect(corsFor(null, true)).toEqual({ allow: true, headers: {} });
    });
});

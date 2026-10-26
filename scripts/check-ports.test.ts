/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { appPort, checkPorts, formatTaken, parseLsofPids, portsFor, portStatus, proxyPort } from './check-ports';

const SCRIPT = join(__dirname, 'check-ports.ts');
const HAS_LSOF = spawnSync('lsof', ['-v']).error === undefined;

function listen(host: string): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen({ port: 0, host }, () => {
            const address = server.address();
            if (address === null || typeof address === 'string') return reject(new Error('no port'));
            resolve({ server, port: address.port });
        });
    });
}

function close(server: Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

/** A port that was free a moment ago (a server took it from the OS and released it). */
async function freePort(): Promise<number> {
    const { server, port } = await listen('127.0.0.1');
    await close(server);
    return port;
}

describe('check-ports: which ports a run script needs', () => {
    test('defaults: app 1234, proxy 8787; APP_PORT and PORT override them separately', () => {
        expect(appPort({})).toBe(1234);
        expect(proxyPort({})).toBe(8787);
        expect(appPort({ APP_PORT: '3000', PORT: '9000' })).toBe(3000);
        expect(proxyPort({ APP_PORT: '3000', PORT: '9000' })).toBe(9000);
        expect(appPort({ PORT: '9000' })).toBe(1234);
        expect(proxyPort({ PORT: ' ' })).toBe(8787);
    });

    test('a value that is not a port is an error, not a silent default', () => {
        expect(() => proxyPort({ PORT: 'abc' })).toThrow('PORT=abc is not a port');
        expect(() => appPort({ APP_PORT: '70000' })).toThrow('APP_PORT=70000 is not a port');
    });

    test('targets: app, proxy, all = both', () => {
        expect(portsFor('app', {}).map((s) => s.port)).toEqual([1234]);
        expect(portsFor('proxy', {}).map((s) => s.port)).toEqual([8787]);
        expect(portsFor('all', {}).map((s) => `${s.name}:${s.port}:${s.envVar}`)).toEqual(['app:1234:APP_PORT', 'proxy:8787:PORT']);
    });

    test('lsof -Fp output: pids only, no duplicates', () => {
        expect(parseLsofPids('p123\nf4\np456\nf5\np123\n')).toEqual([123, 456]);
        expect(parseLsofPids('')).toEqual([]);
    });
});

describe('check-ports: the message', () => {
    test('names the port, what needs it, every holder and the override', () => {
        expect(formatTaken({ name: 'proxy', port: 8787, envVar: 'PORT' }, [{ pid: 42, command: 'bun ./scripts/options-local-proxy.ts' }])).toBe(
            'Port 8787 (proxy) is already in use:\n' +
            '  pid 42: bun ./scripts/options-local-proxy.ts\n' +
            '  stop that process, or start on another port: PORT=<port> bun run proxy',
        );
        expect(formatTaken({ name: 'app', port: 1234, envVar: 'APP_PORT' }, [])).toContain('held by a process lsof cannot show');
    });

    test('all with the same port for both is refused before any lookup', async () => {
        expect(await checkPorts('all', { APP_PORT: '5000', PORT: '5000' })).toBe('The app and the proxy cannot share port 5000: set APP_PORT or PORT to different values');
    });
});

describe('check-ports: real ports', () => {
    test('a free port passes', async () => {
        const port = await freePort();
        expect(await portStatus(port)).toBeNull();
        expect(await checkPorts('proxy', { PORT: String(port) })).toBeNull();
    });

    test('a taken port fails and names this test process as the holder', async () => {
        const { server, port } = await listen('127.0.0.1');
        try {
            const holders = await portStatus(port);
            expect(holders).not.toBeNull();
            if (HAS_LSOF) {
                expect(holders?.map((h) => h.pid)).toContain(process.pid);
                expect(holders?.find((h) => h.pid === process.pid)?.command).toContain('bun');
            }
            const error = await checkPorts('all', { APP_PORT: String(await freePort()), PORT: String(port) });
            expect(error).toContain(`Port ${port} (proxy) is already in use:`);
            expect(error).not.toContain('(app)');
            expect(error).toContain('Nothing was started (bun run all).');
        } finally {
            await close(server);
        }
    });

    test('the CLI exits 1 with the message on stderr, 0 when free, 2 without a target', async () => {
        const { server, port } = await listen('127.0.0.1');
        try {
            const taken = spawnSync(process.execPath, [SCRIPT, 'app'], { encoding: 'utf8', env: { ...process.env, APP_PORT: String(port) } });
            expect(taken.status).toBe(1);
            expect(taken.stderr).toContain(`Port ${port} (app) is already in use:`);
            expect(taken.stderr).toContain('APP_PORT=<port> bun run app');
        } finally {
            await close(server);
        }
        const free = spawnSync(process.execPath, [SCRIPT, 'app'], { encoding: 'utf8', env: { ...process.env, APP_PORT: String(await freePort()) } });
        expect(free.status).toBe(0);
        expect(free.stderr).toBe('');
        expect(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
    });
});

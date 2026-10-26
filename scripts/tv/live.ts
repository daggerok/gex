/// <reference types="node" />
/// <reference types="bun" />
/**
 * The futures watcher as part of the local proxy (owner 2026-10-25, PR #202): `bun run proxy` (and `all`, `start`) also
 * runs `tv:futures` (scripts/tv/futures.ts) as a child process when the TradingView session file exists, so one command
 * starts everything. No session value passes through here: the child reads the env file itself.
 */
import { join } from 'node:path';
import { TV_ENV_PATH } from './env';

/** Why the proxy does or does not start the watcher. */
export type WatcherDecision = { start: true } | { start: false; note: string };

/**
 * Start tv:futures with the proxy? Only when the session file exists and GEX_TV is not 0. The note is the one line the
 * proxy prints instead.
 */
export function watcherDecision(env: Record<string, string | undefined>, envFileExists: boolean, envPath: string = TV_ENV_PATH): WatcherDecision {
    if (env.GEX_TV === '0') return { start: false, note: 'TV     | futures watcher off (GEX_TV=0)' };
    if (!envFileExists) return { start: false, note: `TV     | no TradingView session (${envPath}): futures watcher not started, run bun run tv:session to enable it` };
    return { start: true };
}

/**
 * Run `bun scripts/tv/futures.ts` as a child of the proxy with its output prefixed "TV     | ". When it stops (session
 * expired, rate limited, no network on start) the proxy keeps running and prints one line saying so.
 */
export function spawnFuturesWatcher(log: (line: string) => void = console.log): { stop: () => void } {
    const child = Bun.spawn(['bun', join(__dirname, 'futures.ts')], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    let last = '';
    const pump = async (stream: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        const reader = stream.getReader();
        let buf = '';
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                if (line.trim()) {
                    last = line.trim();
                    log(`TV     | ${line}`);
                }
            }
        }
    };
    void pump(child.stdout);
    void pump(child.stderr);
    let stopping = false;
    void child.exited.then((code) => {
        if (!stopping) log(`TV     | futures watcher stopped (exit ${code})${last ? `: ${last.replace(/^tv:futures failed: /, '')}` : ''}; the proxy keeps running`);
    });
    return {
        stop: () => {
            stopping = true;
            child.kill('SIGTERM');
        },
    };
}

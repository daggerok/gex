/// <reference types="node" />
/// <reference types="bun" />
// When the local proxy starts the tv:futures watcher (scripts/tv/live.ts).
import { describe, expect, test } from 'bun:test';
import { watcherDecision } from './live';

describe('the proxy starts tv:futures', () => {
    test('only with the session file, GEX_TV=0 turns it off, one clear line otherwise', () => {
        expect(watcherDecision({}, true)).toEqual({ start: true });
        const off = watcherDecision({ GEX_TV: '0' }, true);
        expect(off.start).toBe(false);
        const none = watcherDecision({}, false, '/home/x/.config/gex/tradingview.env');
        expect(none).toEqual({ start: false, note: 'TV     | no TradingView session (/home/x/.config/gex/tradingview.env): futures watcher not started, run bun run tv:session to enable it' });
    });
});

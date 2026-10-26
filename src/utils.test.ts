/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { suggestionOnEnter } from './utils';

// Enter in the ticker box (main.tsx onTickerKeyDown): a highlighted row of a list found for an older query must not win over
// the typed ticker (the flaky desk-atm e2e on slow CI: "SPY" + Enter loaded AAPB, the row under the resting mouse pointer).
describe('suggestionOnEnter', () => {
    const items = ['AAPB', 'SPY', 'SPYG'];
    test('the highlighted row of the list found for the typed text', () => {
        expect(suggestionOnEnter({ open: true, items, active: 2, listFor: 'SPY' }, 'SPY')).toBe('SPYG');
        expect(suggestionOnEnter({ open: true, items, active: 1, listFor: 'SPY' }, ' SPY ')).toBe('SPY');
    });
    test('a list of an older query (the debounced search has not answered yet): the typed ticker', () => {
        expect(suggestionOnEnter({ open: true, items, active: 0, listFor: '' }, 'SPY')).toBeNull();
        expect(suggestionOnEnter({ open: true, items, active: 0, listFor: null }, 'SPY')).toBeNull();
    });
    test('nothing highlighted, a closed list or a highlight past the end: the typed ticker', () => {
        expect(suggestionOnEnter({ open: true, items, active: -1, listFor: 'SPY' }, 'SPY')).toBeNull();
        expect(suggestionOnEnter({ open: false, items, active: 1, listFor: 'SPY' }, 'SPY')).toBeNull();
        expect(suggestionOnEnter({ open: true, items, active: 7, listFor: 'SPY' }, 'SPY')).toBeNull();
    });
});

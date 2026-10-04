import { describe, expect, test } from 'bun:test';
import { pickReferenceForward } from './use-gex-levels';
import type { OptionQuote } from './types';

// ---------------------------------------------------------------------------
// Phase 3 of .plans/gex-vix-futures-pricing-research.txt (section 9): the
// pure "which forward does the GEX second-wall rule anchor on" selection
// logic, extracted out of the useGexLevels hook so it's testable without a
// React rendering harness (none exists elsewhere in this repo).
// ---------------------------------------------------------------------------

function q(expiration: string, forward: number | null): OptionQuote {
  return {
    symbol: `TEST${expiration}`, expiration, side: 'call', strike: 20,
    bid: null, ask: null, mid: null, last: null, volume: null, openInterest: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null,
    forward,
  };
}

describe('pickReferenceForward', () => {
  test('returns the nearest (lexicographically smallest) selected expiration\'s forward', () => {
    const quotesByExp = {
      '2026-11-18': [q('2026-11-18', 18.3449)],
      '2026-10-21': [q('2026-10-21', 17.648)],
      '2026-12-16': [q('2026-12-16', 18.7966)],
    };
    expect(pickReferenceForward(quotesByExp, ['2026-11-18', '2026-10-21', '2026-12-16'])).toBeCloseTo(17.648, 6);
  });

  test('skips a nearer expiration with no resolved forward and falls through to the next one', () => {
    const quotesByExp = {
      '2026-10-21': [q('2026-10-21', null)], // forward resolution failed for the nearest exp.
      '2026-11-18': [q('2026-11-18', 18.3449)],
    };
    expect(pickReferenceForward(quotesByExp, ['2026-10-21', '2026-11-18'])).toBeCloseTo(18.3449, 6);
  });

  test('ignores non-selected expirations entirely, even if present in quotesByExp', () => {
    const quotesByExp = {
      '2026-10-21': [q('2026-10-21', 17.648)],
      '2026-11-18': [q('2026-11-18', 18.3449)],
    };
    expect(pickReferenceForward(quotesByExp, ['2026-11-18'])).toBeCloseTo(18.3449, 6);
  });

  test('null when no selected expiration has a resolved, positive forward', () => {
    const quotesByExp = {
      '2026-10-21': [q('2026-10-21', null)],
      '2026-11-18': [q('2026-11-18', 0)], // 0 is not a valid forward
    };
    expect(pickReferenceForward(quotesByExp, ['2026-10-21', '2026-11-18'])).toBeNull();
    expect(pickReferenceForward({}, [])).toBeNull();
    expect(pickReferenceForward({}, ['2026-10-21'])).toBeNull();
  });
});

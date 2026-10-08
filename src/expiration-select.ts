// Which expirations to select when the user switches to another ticker. Pure, unit-tested in
// expiration-select.test.ts. Dates are ISO strings (YYYY-MM-DD), so plain string comparison orders them.

/** Picks the selection for a new ticker with the `available` expirations (ascending), given what was
 *  selected for the previous ticker:
 *  1. the same dates, as many of them as the new ticker has;
 *  2. none of them exist: every available expiration inside the previous selection's date range
 *     (earliest..latest selected date);
 *  3. nothing inside that range either (or nothing was selected before): the first available one.
 *  Returns [] only when there is nothing available. */
export function pickExpirations(previous: readonly string[], available: readonly string[]): string[] {
    if (available.length === 0) return [];
    if (previous.length === 0) return [available[0]];
    const same = available.filter((d) => previous.includes(d));
    if (same.length > 0) return same;
    const sorted = [...previous].sort();
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const inRange = available.filter((d) => d >= lo && d <= hi);
    if (inRange.length > 0) return inRange;
    return [available[0]];
}

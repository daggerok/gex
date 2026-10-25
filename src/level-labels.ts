/// <reference lib="esnext" />
// Pure helpers for the GEX chart's Key Level labels: levels that land on the
// same price share ONE label instead of drawing on top of each other. No
// React, no DOM, unit-tested in level-labels.test.ts.

export interface LevelLabelItem {
    key: string;
    value: number;
    text: string;
    color: string;
}

export interface LevelLabelGroup {
    value: number;
    items: LevelLabelItem[];
}

/** Joined label longer than this many characters is stacked, one level per line.
 *  Chosen from the chart's bottom margin: at fontSize 10 and a -45deg rotation
 *  about 26 characters still fit below the X axis without clipping. */
export const MAX_INLINE_LABEL_CHARS = 26;

export const LEVEL_LABEL_SEPARATOR = ' + ';

/** Two levels share a label when their prices are equal to 6 decimals (strikes are
 *  exact, Gamma Flip and Spot are floats and could differ in the last digits). */
const sameValue = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** Groups items by price, keeping the input order inside a group and ordering
 *  groups by the first appearance of their price. */
export function groupLevelLabels(items: readonly LevelLabelItem[]): LevelLabelGroup[] {
    const groups: LevelLabelGroup[] = [];
    for (const item of items) {
        const group = groups.find((g) => sameValue(g.value, item.value));
        if (group) group.items.push(item);
        else groups.push({ value: item.value, items: [item] });
    }
    return groups;
}

/**
 * Groups levels whose lines are closer than `minGap` price units (a few pixels on the screen), so their labels share ONE
 * text, "A + B", instead of printing over each other, as already done for levels on the same price. Levels are taken
 * in price order, a chain of close levels joins one group, a group has its lowest price (the label sits on that line) and
 * lists its levels from the lowest up. `minGap` of 0 groups only equal prices.
 */
export function groupNearLevelLabels(items: readonly LevelLabelItem[], minGap: number): LevelLabelGroup[] {
    const gap = Math.max(minGap, 1e-6);
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const groups: LevelLabelGroup[] = [];
    for (const item of sorted) {
        const last = groups[groups.length - 1];
        if (last && item.value - last.items[last.items.length - 1].value <= gap) last.items.push(item);
        else groups.push({ value: item.value, items: [item] });
    }
    return groups;
}

/** 'inline' = "A + B + C" on one line, 'stacked' = one level per line. A single
 *  level is always inline. */
export function labelLayout(group: LevelLabelGroup): 'inline' | 'stacked' {
    if (group.items.length < 2) return 'inline';
    const joined = group.items.map((i) => i.text).join(LEVEL_LABEL_SEPARATOR);
    return joined.length > MAX_INLINE_LABEL_CHARS ? 'stacked' : 'inline';
}

/** A price line label of the Chart tab: a level's key, its price and its title. */
export interface PriceLineLabel {
    key: string;
    value: number;
    text: string;
}

/**
 * Chart tab labels with the Sigma levels (owner 2026-10-25: Sigma labels never overlap the other level labels and go
 * through the same grouping as on the GEX chart). The levels keep one price line each (the chart library stacks their
 * labels at the price axis). A Sigma strike on the price of a shown level joins that level's title in the same group
 * order, "Max Net GEX + 1σ", and gets no label of its own. The other Sigma strikes get one label per strike,
 * "<strike> 1σ" (or "<strike> 1σ + 2σ" when two steps snap to one strike), drawn as a price line without a line.
 * `levels` and `sigma` are in display order (levels in their fixed order, Sigma by strike then step).
 */
export function chartLabelsWithSigma(
    levels: readonly PriceLineLabel[],
    sigma: readonly PriceLineLabel[],
    strikeText: (value: number) => string,
): { titles: Record<string, string>; sigma: PriceLineLabel[] } {
    const sigmaKeys = new Set(sigma.map((s) => s.key));
    const groups = groupLevelLabels([...levels, ...sigma].map((l) => ({ ...l, color: '' })));
    const titles: Record<string, string> = {};
    for (const l of levels) titles[l.key] = l.text;
    const own: PriceLineLabel[] = [];
    for (const g of groups) {
        const steps = g.items.filter((i) => sigmaKeys.has(i.key));
        if (steps.length === 0) continue;
        const host = g.items.find((i) => !sigmaKeys.has(i.key));
        const joined = steps.map((i) => i.text).join(LEVEL_LABEL_SEPARATOR);
        if (host) titles[host.key] = `${host.text}${LEVEL_LABEL_SEPARATOR}${joined}`;
        else own.push({ key: steps[0].key, value: g.value, text: `${strikeText(g.value)} ${joined}` });
    }
    return { titles, sigma: own };
}

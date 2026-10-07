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

/** 'inline' = "A + B + C" on one line, 'stacked' = one level per line. A single
 *  level is always inline. */
export function labelLayout(group: LevelLabelGroup): 'inline' | 'stacked' {
    if (group.items.length < 2) return 'inline';
    const joined = group.items.map((i) => i.text).join(LEVEL_LABEL_SEPARATOR);
    return joined.length > MAX_INLINE_LABEL_CHARS ? 'stacked' : 'inline';
}

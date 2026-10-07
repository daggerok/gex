import { describe, expect, test } from 'bun:test';
import { groupLevelLabels, labelLayout, MAX_INLINE_LABEL_CHARS, type LevelLabelItem } from './level-labels';

const item = (key: string, value: number, text: string): LevelLabelItem => ({ key, value, text, color: '#000' });

describe('groupLevelLabels', () => {
  test('levels on the same price share one group, order inside a group is the input order', () => {
    const groups = groupLevelLabels([item('netGexPlus', 778, 'Net GEX+'), item('spot', 775.83, 'Spot'), item('sumNetGexPlus', 778, '75% Sum Net GEX+')]);
    expect(groups.map((g) => [g.value, g.items.map((i) => i.key)])).toEqual([
      [778, ['netGexPlus', 'sumNetGexPlus']],
      [775.83, ['spot']],
    ]);
  });

  test('float prices that differ below 1e-6 are the same level, 1e-3 apart are not', () => {
    expect(groupLevelLabels([item('a', 775.83, 'A'), item('b', 775.83 + 1e-9, 'B')])).toHaveLength(1);
    expect(groupLevelLabels([item('a', 775.83, 'A'), item('b', 775.831, 'B')])).toHaveLength(2);
  });

  test('empty input -> no groups', () => {
    expect(groupLevelLabels([])).toEqual([]);
  });
});

describe('labelLayout', () => {
  test('a single level is always inline, however long its name', () => {
    expect(labelLayout({ value: 1, items: [item('a', 1, 'A very very very long level name indeed')] })).toBe('inline');
  });

  test('"Spot + Max Pain" (15 chars) fits inline', () => {
    expect(labelLayout({ value: 1, items: [item('a', 1, 'Spot'), item('b', 1, 'Max Pain')] })).toBe('inline');
  });

  test('"Net GEX+ + 75% Sum Net GEX+" (30 chars) is stacked', () => {
    const joined = 'Net GEX+ + 75% Sum Net GEX+';
    expect(joined.length).toBeGreaterThan(MAX_INLINE_LABEL_CHARS);
    expect(labelLayout({ value: 1, items: [item('a', 1, 'Net GEX+'), item('b', 1, '75% Sum Net GEX+')] })).toBe('stacked');
  });

  test('the boundary is inclusive: exactly MAX_INLINE_LABEL_CHARS stays inline, one more stacks', () => {
    const base = 'A'.repeat(MAX_INLINE_LABEL_CHARS - 3 - 1); // + ' + ' + 1 char
    expect(labelLayout({ value: 1, items: [item('a', 1, base), item('b', 1, 'B')] })).toBe('inline');
    expect(labelLayout({ value: 1, items: [item('a', 1, base + 'A'), item('b', 1, 'B')] })).toBe('stacked');
  });
});

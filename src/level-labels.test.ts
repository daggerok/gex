/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { chartLabelsWithSigma, groupLevelLabels, groupNearLevelLabels, labelLayout, MAX_INLINE_LABEL_CHARS, type LevelLabelItem } from './level-labels';

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

  test('Zero GEX on the same strike as Min Net GEX shares its label, never prints over it', () => {
    const groups = groupLevelLabels([item('minNetGex', 755, 'Min Net GEX'), item('zeroGex', 755, 'Zero GEX'), item('maxPain', 766, 'Max Pain')]);
    expect(groups.map((g) => [g.value, g.items.map((i) => i.text).join(' + ')])).toEqual([[755, 'Min Net GEX + Zero GEX'], [766, 'Max Pain']]);
  });
});

describe('groupNearLevelLabels', () => {
  test('two levels a few pixels apart share one label, the lower price first', () => {
    // Gamma Flip 774.68 and Max Pain 774.00 on a chart where 1 price unit is about 17 px: their labels overlapped
    const groups = groupNearLevelLabels([item('gammaFlip', 774.68, 'Gamma Flip'), item('maxPain', 774, 'Max Pain'), item('spot', 778.57, 'Spot')], 1);
    expect(groups.map((g) => [g.value, g.items.map((i) => i.key)])).toEqual([[774, ['maxPain', 'gammaFlip']], [778.57, ['spot']]]);
  });

  test('Zero GEX next to the Gamma Flip joins one label, ordered by price', () => {
    const groups = groupNearLevelLabels([item('gammaFlip', 757.4, 'Gamma Flip'), item('zeroGex', 757, 'Zero GEX'), item('spot', 760, 'Spot')], 1);
    expect(groups.map((g) => [g.value, g.items.map((i) => i.key)])).toEqual([[757, ['zeroGex', 'gammaFlip']], [760, ['spot']]]);
  });

  test('levels far enough apart keep their own labels', () => {
    expect(groupNearLevelLabels([item('a', 770, 'A'), item('b', 772.5, 'B')], 1)).toHaveLength(2);
  });

  test('the gap itself still joins, a chain of close levels is one group', () => {
    expect(groupNearLevelLabels([item('a', 770, 'A'), item('b', 771, 'B')], 1)).toHaveLength(1);
    expect(groupNearLevelLabels([item('a', 770, 'A'), item('b', 771, 'B'), item('c', 772, 'C'), item('d', 774, 'D')], 1).map((g) => g.items.length)).toEqual([3, 1]);
  });

  test('a zero gap groups only equal prices, like groupLevelLabels', () => {
    const items = [item('a', 778, 'A'), item('b', 775.83, 'B'), item('c', 778, 'C')];
    expect(groupNearLevelLabels(items, 0).map((g) => g.items.map((i) => i.key))).toEqual([['b'], ['a', 'c']]);
  });

  test('no levels, no groups; the input is not changed', () => {
    expect(groupNearLevelLabels([], 5)).toEqual([]);
    const input = [item('b', 2, 'B'), item('a', 1, 'A')];
    groupNearLevelLabels(input, 5);
    expect(input.map((i) => i.key)).toEqual(['b', 'a']);
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

describe('Sigma labels', () => {
  const pl = (key: string, value: number, text: string) => ({ key, value, text });

  test('GEX chart: a Sigma strike on Max Net GEX shares one label "Max Net GEX + 1σ"', () => {
    const groups = groupLevelLabels([item('maxNetGex', 7770, 'Max Net GEX'), item('sigma:+1', 7770, '1σ'), item('sigma:+2', 7850, '2σ')]);
    expect(groups.map((g) => [g.value, g.items.map((i) => i.text).join(' + ')])).toEqual([[7770, 'Max Net GEX + 1σ'], [7850, '2σ']]);
  });

  test('GEX chart: close Sigma and level labels join in price order, lowest first', () => {
    const groups = groupNearLevelLabels([item('sigma:+1', 7772, '1σ'), item('maxNetGex', 7770, 'Max Net GEX'), item('sigma:-1', 7620, '1σ')], 5);
    expect(groups.map((g) => g.items.map((i) => i.text))).toEqual([['1σ'], ['Max Net GEX', '1σ']]);
  });

  test('Chart tab: a Sigma strike on a shown level joins its title, the others get "<strike> 1σ", none is lost', () => {
    const out = chartLabelsWithSigma(
      [pl('maxNetGex', 7770, 'Max Net GEX'), pl('spot', 7700.5, 'Spot')],
      [pl('sigma:+2', 7850, '2σ'), pl('sigma:+1', 7770, '1σ'), pl('sigma:-1', 7620, '1σ')],
      (v) => String(v),
    );
    expect(out.titles).toEqual({ maxNetGex: 'Max Net GEX + 1σ', spot: 'Spot' });
    expect(out.sigma).toEqual([pl('sigma:+2', 7850, '7850 2σ'), pl('sigma:-1', 7620, '7620 1σ')]);
  });

  test('Chart tab: two Sigma steps on one strike are one label, in step order', () => {
    const out = chartLabelsWithSigma([], [pl('sigma:+2', 102, '2σ'), pl('sigma:+3', 102, '3σ')], (v) => String(v));
    expect(out.sigma).toEqual([pl('sigma:+2', 102, '102 2σ + 3σ')]);
  });

  test('Chart tab: no Sigma keeps every title as it is', () => {
    expect(chartLabelsWithSigma([pl('maxPain', 100, 'Max Pain')], [], String)).toEqual({ titles: { maxPain: 'Max Pain' }, sigma: [] });
  });
});

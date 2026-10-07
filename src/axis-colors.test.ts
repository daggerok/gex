import { describe, expect, test } from 'bun:test';
import { AXIS_NEUTRAL, countAxisColor, netGexAxisColor, ratioAxisColor } from './axis-colors';

const colors = { netGexPos: '#g', netGexNeg: '#r', callOi: '#co', putOi: '#po', callVolume: '#cv', putVolume: '#pv', pcRatioOi: '#ro', pcRatioVolume: '#rv' };

describe('axis tick colors follow the series on the axis', () => {
  test('Net GEX axis: positive ticks green side, negative red side, zero neutral', () => {
    expect(netGexAxisColor(5, colors)).toBe('#g');
    expect(netGexAxisColor(-5, colors)).toBe('#r');
    expect(netGexAxisColor(0, colors)).toBe(AXIS_NEUTRAL);
  });

  test('counts axis: positive ticks use the first active call metric, negative the first active put metric', () => {
    expect(countAxisColor(10, ['callOi', 'putOi'], colors)).toBe('#co');
    expect(countAxisColor(-10, ['callOi', 'putOi'], colors)).toBe('#po');
    // OI wins over Volume on the same side, Volume is used when OI is off
    expect(countAxisColor(10, ['callVolume', 'callOi'], colors)).toBe('#co');
    expect(countAxisColor(10, ['callVolume', 'putOi'], colors)).toBe('#cv');
    expect(countAxisColor(-10, ['callOi', 'putVolume'], colors)).toBe('#pv');
  });

  test('counts axis: a side without an active metric falls back to the other family, nothing active is neutral', () => {
    expect(countAxisColor(10, ['putOi'], colors)).toBe('#po');
    expect(countAxisColor(-10, ['callVolume'], colors)).toBe('#cv');
    expect(countAxisColor(10, [], colors)).toBe(AXIS_NEUTRAL);
    expect(countAxisColor(0, ['callOi'], colors)).toBe(AXIS_NEUTRAL);
  });

  test('ratio axis: the first active ratio metric, OI before Volume, neutral when none', () => {
    expect(ratioAxisColor(['pcRatioVolume', 'pcRatioOi'], colors)).toBe('#ro');
    expect(ratioAxisColor(['pcRatioVolume'], colors)).toBe('#rv');
    expect(ratioAxisColor([], colors)).toBe(AXIS_NEUTRAL);
  });
});

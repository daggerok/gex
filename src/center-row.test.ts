/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { middleScrollDelta } from './center-row';

describe('middleScrollDelta: how far to scroll so a row sits in the middle of the visible area', () => {
  test('no sticky inset: the row center goes to the container center', () => {
    // container 100..500 (center 300), row 600..620 (center 610): scroll down 310
    expect(middleScrollDelta({ top: 100, bottom: 500 }, { top: 600, height: 20 })).toBe(310);
    // a row above the middle scrolls up (negative)
    expect(middleScrollDelta({ top: 100, bottom: 500 }, { top: 140, height: 20 })).toBe(-150);
  });

  test('a sticky inset at the top moves the target to the middle of what is visible below it', () => {
    // usable 160..500, center 330; row center 340 -> 10
    expect(middleScrollDelta({ top: 100, bottom: 500 }, { top: 330, height: 20 }, 60)).toBe(10);
  });

  test('a row already in the middle needs no scroll', () => {
    expect(middleScrollDelta({ top: 0, bottom: 400 }, { top: 190, height: 20 })).toBe(0);
  });
});

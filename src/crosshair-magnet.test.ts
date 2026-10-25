/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { CROSSHAIR_SNAP_PX, snapPrice } from './crosshair-magnet';

describe('snapPrice: the crosshair magnet to the open, high, low or close', () => {
  // a candle: high 110 at y 100, open 106 at y 140, close 103 at y 170, low 100 at y 200
  const candle = [{ price: 106, y: 140 }, { price: 110, y: 100 }, { price: 100, y: 200 }, { price: 103, y: 170 }];

  test('within the threshold: the nearest of the four', () => {
    expect(snapPrice(104, candle)).toBe(110); // 4 px from the high
    expect(snapPrice(166, candle)).toBe(103); // 4 px from the close, 26 from the open
    expect(snapPrice(200 + CROSSHAIR_SNAP_PX, candle)).toBe(100); // exactly at the threshold still snaps
  });

  test('farther than the threshold: free (null)', () => {
    expect(snapPrice(120, candle)).toBeNull(); // 20 px from the high, 20 from the open
    expect(snapPrice(200 + CROSSHAIR_SNAP_PX + 0.5, candle)).toBeNull();
    expect(snapPrice(150, candle, 5)).toBeNull(); // 10 px from the open with a 5 px threshold
  });

  test('equal distance to two prices: the lower price', () => {
    expect(snapPrice(155, [{ price: 106, y: 150 }, { price: 103, y: 160 }], 8)).toBe(103);
  });

  test('a flat candle (all four equal) snaps to that price; bad inputs are ignored', () => {
    expect(snapPrice(52, [{ price: 7, y: 50 }, { price: 7, y: 50 }, { price: 7, y: 50 }, { price: 7, y: 50 }])).toBe(7);
    expect(snapPrice(NaN, candle)).toBeNull();
    expect(snapPrice(100, [{ price: NaN, y: 100 }, { price: 110, y: NaN }])).toBeNull();
    expect(snapPrice(100, [])).toBeNull();
  });
});

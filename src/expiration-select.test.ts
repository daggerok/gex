import { describe, expect, test } from 'bun:test';
import { pickExpirations } from './expiration-select';

const avail = ['2026-10-05', '2026-10-06', '2026-10-09', '2026-10-16', '2026-11-20'];

describe('pickExpirations', () => {
  test('the same dates when the new ticker has them all', () => {
    expect(pickExpirations(['2026-10-09', '2026-10-16'], avail)).toEqual(['2026-10-09', '2026-10-16']);
  });

  test('only the dates the new ticker has when some are missing', () => {
    expect(pickExpirations(['2026-10-09', '2026-10-14', '2026-10-16'], avail)).toEqual(['2026-10-09', '2026-10-16']);
  });

  test('no common date: everything available inside the previous range', () => {
    // previous 10-07 and 10-12 are not available, the range 10-07..10-12 contains only 10-09
    expect(pickExpirations(['2026-10-07', '2026-10-12'], avail)).toEqual(['2026-10-09']);
    expect(pickExpirations(['2026-10-07', '2026-10-17'], ['2026-10-08', '2026-10-09', '2026-10-15', '2026-10-20'])).toEqual(['2026-10-08', '2026-10-09', '2026-10-15']);
  });

  test('nothing inside the range: the first available expiration', () => {
    expect(pickExpirations(['2026-12-18'], avail)).toEqual(['2026-10-05']);
    expect(pickExpirations(['2026-09-01', '2026-09-04'], avail)).toEqual(['2026-10-05']);
  });

  test('nothing selected before: the first available expiration, nothing available: empty', () => {
    expect(pickExpirations([], avail)).toEqual(['2026-10-05']);
    expect(pickExpirations(['2026-10-09'], [])).toEqual([]);
  });

  test('the order of the previous selection does not matter', () => {
    expect(pickExpirations(['2026-10-12', '2026-10-07'], avail)).toEqual(pickExpirations(['2026-10-07', '2026-10-12'], avail));
    expect(pickExpirations(['2026-10-16', '2026-10-05'], avail)).toEqual(['2026-10-05', '2026-10-16']);
  });
});

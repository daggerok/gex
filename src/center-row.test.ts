/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { afterEach, beforeEach } from 'bun:test';
import { USER_SCROLL_EVENTS, centerRowInScroll, middleScrollDelta } from './center-row';

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

// a tiny stand-in for the browser: animation frames run when the test says so, the window is an EventTarget, the container
// scrolls by its scrollTop and the row moves up by as much (row top = 900 - scrollTop, container 0..400 -> middle at 200)
describe('centerRowInScroll: the user wins over a centering still in progress', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { window: g.window, requestAnimationFrame: g.requestAnimationFrame, cancelAnimationFrame: g.cancelAnimationFrame };
  let frames: Map<number, () => void>;
  let nextId: number;
  const runFrame = () => { const due = Array.from(frames.values()); frames.clear(); due.forEach((f) => f()); };
  const win = new EventTarget();
  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    g.window = win;
    g.requestAnimationFrame = (f: () => void) => { frames.set(nextId, f); return nextId++; };
    g.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  });
  afterEach(() => { Object.assign(g, saved); });

  function desk() {
    const inside = new EventTarget();
    const box = {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      contains: (n: unknown) => n === inside || n === box,
    };
    const row = { getBoundingClientRect: () => ({ top: 900 - box.scrollTop, height: 20 }) };
    // events reach the window listeners (capture) with the target inside the desk
    const fire = (type: string, target: unknown) => { const e = new Event(type); Object.defineProperty(e, 'target', { value: target }); win.dispatchEvent(e); };
    return { box, row, inside, fire };
  }

  test('without the user: the row ends in the middle and the retries stop', () => {
    const d = desk();
    centerRowInScroll(() => d.box as unknown as HTMLElement, () => d.row as unknown as HTMLElement);
    runFrame();
    expect(d.box.scrollTop).toBe(710);
    runFrame();
    expect(frames.size).toBe(0);
  });

  test('a scroll of the container between two retries is undone without user input (why the yield exists)', () => {
    const d = desk();
    let moving = true; // rows still settling: the first step is followed by another retry
    const row = { getBoundingClientRect: () => ({ top: 900 - d.box.scrollTop + (moving ? 30 : 0), height: 20 }) };
    centerRowInScroll(() => d.box as unknown as HTMLElement, () => row as unknown as HTMLElement);
    runFrame();
    moving = false;
    d.box.scrollTop += 37; // not a user input event: a later retry may re-center
    runFrame();
    expect(d.box.scrollTop).toBe(710);
  });

  for (const type of USER_SCROLL_EVENTS) {
    test(`a ${type} inside the container stops the pending retries, the user's scroll stays`, () => {
      const d = desk();
      centerRowInScroll(() => d.box as unknown as HTMLElement, () => d.row as unknown as HTMLElement);
      runFrame();
      d.fire(type, d.inside);
      d.box.scrollTop += 37;
      runFrame();
      expect(d.box.scrollTop).toBe(747);
      expect(frames.size).toBe(0);
    });
  }

  test('input outside the container does not stop the centering', () => {
    const d = desk();
    centerRowInScroll(() => d.box as unknown as HTMLElement, () => null);
    d.fire('wheel', new EventTarget());
    expect(frames.size).toBe(1);
  });

  test('the stop function and the end of the centering remove the window listeners', () => {
    const d = desk();
    let added = 0;
    const add = win.addEventListener.bind(win);
    const remove = win.removeEventListener.bind(win);
    (win as unknown as { addEventListener: typeof add }).addEventListener = (...a: Parameters<typeof add>) => { added++; add(...a); };
    (win as unknown as { removeEventListener: typeof remove }).removeEventListener = (...a: Parameters<typeof remove>) => { added--; remove(...a); };
    try {
      centerRowInScroll(() => d.box as unknown as HTMLElement, () => d.row as unknown as HTMLElement);
      expect(added).toBe(USER_SCROLL_EVENTS.length);
      runFrame();
      runFrame();
      expect(added).toBe(0);
      const stop = centerRowInScroll(() => d.box as unknown as HTMLElement, () => null);
      stop();
      expect(added).toBe(0);
    } finally {
      delete (win as unknown as Record<string, unknown>).addEventListener;
      delete (win as unknown as Record<string, unknown>).removeEventListener;
    }
  });
});

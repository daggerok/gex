/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { edgeFadeMask, edgeScrollTarget, scrollEdges } from './edge-scroll';

// five chips 100 px wide with 10 px gaps: 0-100, 110-210, 220-320, 330-430, 440-540 (scrollWidth 540)
const CHIPS = [0, 110, 220, 330, 440].map((left) => ({ left, right: left + 100 }));

describe('scrollEdges', () => {
    test('a side has more content when the row is not scrolled to that end', () => {
        expect(scrollEdges(0, 300, 540)).toEqual({ left: false, right: true });
        expect(scrollEdges(120, 300, 540)).toEqual({ left: true, right: true });
        expect(scrollEdges(240, 300, 540)).toEqual({ left: true, right: false });
    });

    test('everything fits: no side; sub-pixel offsets count as the end', () => {
        expect(scrollEdges(0, 600, 540)).toEqual({ left: false, right: false });
        expect(scrollEdges(0.5, 300, 540)).toEqual({ left: false, right: true });
        expect(scrollEdges(239.5, 300, 540)).toEqual({ left: true, right: false });
    });
});

describe('edgeScrollTarget', () => {
    test('next: the first chip past the right edge (or under its button) ends inset px inside the edge', () => {
        // view 0..300, inset 30: visible up to 270; chip 220-320 is cut -> scrollLeft 320 - 300 + 30 = 50
        expect(edgeScrollTarget(CHIPS, 0, 300, 540, 1, 30)).toBe(50);
        // from 50 (view 50..350, visible to 320): chip 220-320 fits now, next is 330-430 -> 430 - 270 = 160
        expect(edgeScrollTarget(CHIPS, 50, 300, 540, 1, 30)).toBe(160);
    });

    test('previous: the last chip left of the left edge (or under its button) starts inset px inside the edge', () => {
        // view 160..460, inset 30: visible from 190; chip 110-210 is cut -> 110 - 30 = 80
        expect(edgeScrollTarget(CHIPS, 160, 300, 540, -1, 30)).toBe(80);
        // from 80 (visible from 110): chip 110-210 fits, previous is 0-100 -> -30 clamped to 0
        expect(edgeScrollTarget(CHIPS, 80, 300, 540, -1, 30)).toBe(0);
    });

    test('clamped to the scroll range, null when nothing is hidden in that direction', () => {
        expect(edgeScrollTarget(CHIPS, 200, 300, 540, 1, 30)).toBe(240); // last chip: 540 - 270 = 270 -> max 240
        expect(edgeScrollTarget(CHIPS, 240, 300, 540, 1, 0)).toBeNull();
        expect(edgeScrollTarget(CHIPS, 0, 300, 540, -1, 0)).toBeNull();
        expect(edgeScrollTarget([], 0, 300, 540, 1, 30)).toBeNull();
    });
});

describe('edgeFadeMask', () => {
    test('fades only the clipped sides', () => {
        expect(edgeFadeMask({ left: false, right: false }, 24)).toBeNull();
        expect(edgeFadeMask({ left: false, right: true }, 24)).toBe('linear-gradient(to right, #000 0, #000 calc(100% - 24px), transparent 100%)');
        expect(edgeFadeMask({ left: true, right: false }, 24)).toBe('linear-gradient(to right, transparent 0, #000 24px, #000 100%)');
        expect(edgeFadeMask({ left: true, right: true }, 24)).toBe('linear-gradient(to right, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%)');
    });
});

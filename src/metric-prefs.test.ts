/// <reference types="bun" />
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { DEFAULT_METRIC_COLORS } from './gex-colors';
import { applySignColorVars, getMetricColors, resetMetricColors, setMetricColor, SIGN_COLOR_VARS, signColor } from './metric-prefs';

describe('sign colours: one source of truth (owner, 2026-10-25)', () => {
    const set = { netGexPos: '#38bdf8', netGexNeg: '#f97316' };

    test('signColor: positive -> the Net GEX (+) colour, negative -> (-), zero or no number -> null', () => {
        expect(signColor(3, set)).toBe('#38bdf8');
        expect(signColor(-0.5, set)).toBe('#f97316');
        expect(signColor(0, set)).toBeNull();
        expect(signColor(null, set)).toBeNull();
        expect(signColor(Number.NaN, set)).toBeNull();
    });

    test('the CSS variables carry the two colours', () => {
        const props: Record<string, string> = {};
        applySignColorVars(set, { style: { setProperty: (k, v) => { props[k] = v; } } });
        expect(props).toEqual({ [SIGN_COLOR_VARS.pos]: '#38bdf8', [SIGN_COLOR_VARS.neg]: '#f97316' });
        applySignColorVars(set, null); // no document: nothing to do, no throw
    });

    test('a custom positive colour is THE positive colour until Reset brings green and red back', () => {
        setMetricColor('netGexPos', '#38bdf8');
        expect(getMetricColors().netGexPos).toBe('#38bdf8');
        expect(signColor(1, getMetricColors())).toBe('#38bdf8');
        resetMetricColors();
        expect(getMetricColors().netGexPos).toBe(DEFAULT_METRIC_COLORS.netGexPos);
        expect(getMetricColors().netGexNeg).toBe(DEFAULT_METRIC_COLORS.netGexNeg);
        expect(signColor(1, getMetricColors())).toBe('#089981');
        expect(signColor(-1, getMetricColors())).toBe('#f23645');
    });
});

#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * bun run tv:check - is the TradingView session usable for futures options GEX? LOCAL ONLY.
 * Requests: 1 GET tradingview.com/chart/ (auth token), 1 websocket with 3 symbols, 1 scanner POST (2 rows).
 * Prints one status line, then details:
 *   ok
 *   no session -> run bun run tv:session
 *   session expired -> run bun run tv:session
 *   no CME entitlement (OI empty)                  the option quote or its OI did not arrive
 *   no realtime CME entitlement (10 min delayed)   OI works, prices are delayed
 *   rate limited                                   429 / 403: wait, do not retry in a loop
 *   error                                          anything else (the details say what)
 * Exit code 0 only for "ok". Never prints the session values or the token.
 */
import { familiesOf, futuresPrice, optionSymbol, pickSeries, QUOTE_FIELDS, scanGreeks, TvRateLimitError, type QuoteValues } from './chain';
import { loadTvSession, redact, sleep, TV_ENV_PATH, type TvSession } from './env';
import { fetchAuthToken, randomId, TvSocket } from './ws';

const CONTINUOUS = 'CME_MINI:ES1!';

export type CheckStatus = 'ok' | 'no session -> run bun run tv:session' | 'session expired -> run bun run tv:session' | 'no CME entitlement (OI empty)' | 'no realtime CME entitlement (10 min delayed)' | 'rate limited' | 'error';

function finish(status: CheckStatus, details: string[], session: TvSession | null): void {
    console.log(status);
    for (const d of details) console.log(`  ${redact(d, session)}`);
    process.exitCode = status === 'ok' ? 0 : 1;
}

async function main(): Promise<void> {
    const details: string[] = [];
    const session = loadTvSession();
    if (!session) return finish('no session -> run bun run tv:session', [`${TV_ENV_PATH} has no TV_SESSIONID`], null);

    const auth = await fetchAuthToken(session);
    if (auth.status === 429 || auth.status === 403) return finish('rate limited', [`tradingview.com answered ${auth.status}`], session);
    if (!auth.token || !auth.loggedIn) return finish('session expired -> run bun run tv:session', ['the logged-in page has no auth token (sessionid rejected)'], session);
    details.push(`login ok, pro plan ${auth.isPro ?? 'unknown'}, sessionid_sign ${session.sessionidSign ? 'present' : 'absent (not needed)'}`);

    const values = new Map<string, QuoteValues>();
    const done = new Set<string>();
    let wsError = '';
    const sock = new TvSocket({
        session,
        onMessage: (m) => {
            if (m.m === 'qsd') {
                const p = m.p[1] as { n: string; s: string; v?: QuoteValues };
                values.set(p.n, Object.assign(values.get(p.n) ?? {}, p.v ?? {}, { _s: p.s }));
                if (p.s === 'error') done.add(p.n);
            } else if (m.m === 'quote_completed') done.add(String(m.p[1]));
            else if (m.m === 'critical_error' || m.m === 'protocol_error') wsError = m.m;
        },
    });
    const waitFor = async (sym: string) => {
        for (let i = 0; i < 40 && !done.has(sym) && !wsError && !sock.closed; i++) await sleep(250);
    };
    try {
        await sock.opened;
        const qs = randomId('qs_');
        sock.send('set_auth_token', [auth.token]);
        sock.send('quote_create_session', [qs]);
        sock.send('quote_set_fields', [qs, ...QUOTE_FIELDS]);
        sock.send('quote_add_symbols', [qs, CONTINUOUS]);
        await waitFor(CONTINUOUS);
        const cont = values.get(CONTINUOUS);
        if (wsError || !cont || cont._s !== 'ok' || !cont.front_contract) return finish('error', [...details, `websocket: ${wsError || 'no quote for ' + CONTINUOUS}`], session);
        const front = `CME_MINI:${String(cont.front_contract)}`;
        const fut = futuresPrice(cont);
        const picked = pickSeries(familiesOf(cont), front, new Date(), 1)[0];
        if (!picked || !fut) return finish('error', [...details, `no option series or no price under ${front}`], session);
        const { family, series } = picked;
        const strike = series.strikes.reduce((best, k) => (Math.abs(k - fut.price) < Math.abs(best - fut.price) ? k : best), series.strikes[0]);
        const opt = optionSymbol(family.prefix, series.root, series.exp, 'put', strike);
        sock.send('quote_add_symbols', [qs, opt]);
        await waitFor(opt);
        const v = values.get(opt) ?? {};
        const oi = (v.oi as { value?: number } | undefined)?.value;
        details.push(`front ${front} ${String(cont.update_mode ?? '')}, probe ${opt}: OI ${oi ?? 'none'}, volume ${v.volume ?? 'none'}, bid ${v.bid ?? '-'} ask ${v.ask ?? '-'}, ${String(v.update_mode ?? '')}`);

        let gamma: number | null = null;
        try {
            const scan = await scanGreeks(front, [{ symbol: opt, root: series.root, exp: series.exp, side: 'put', strike }], session);
            gamma = scan.get(opt.slice(opt.indexOf(':') + 1))?.gamma ?? null;
            details.push(`scanner: ${scan.size} rows, gamma ${gamma ?? 'none'}`);
        } catch (err) {
            if (err instanceof TvRateLimitError) return finish('rate limited', [...details, err.message], session);
            details.push(`scanner: ${(err as Error).message}`);
        }

        if (v._s !== 'ok' || oi == null) return finish('no CME entitlement (OI empty)', details, session);
        if (gamma == null) return finish('error', [...details, 'the scanner returned no greeks'], session);
        if (String(v.update_mode ?? '').startsWith('delayed')) return finish('no realtime CME entitlement (10 min delayed)', details, session);
        return finish('ok', details, session);
    } finally {
        sock.close();
    }
}

if (require.main === module) {
    main().catch((err: unknown) => finish('error', [err instanceof Error ? err.message : String(err)], loadTvSession()));
}

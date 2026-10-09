// Compare two data/options directories written by options-data.py and options-data.ts.
//   bun scripts/options-parity/compare.ts <dirA> <dirB> [file ...]
// EXACT       byte-identical once the `updated` value is masked
// STRUCTURAL  identical once every number is masked (same keys, order, nulls, number formatting
//             style) but some values differ, drift is quantified per numeric quote field
// DIFFERENT   anything else, the first differing position is printed
// Exit code 1 when any file is DIFFERENT or missing. Temporary tool: delete together with options-data.py.
/// <reference types="bun" />
/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [a, b, ...only] = process.argv.slice(2);
if (!a || !b) {
    console.error("usage: bun compare.ts <dirA> <dirB> [file ...]");
    process.exit(2);
}
const files = only.length ? only : readdirSync(a).filter((f) => f.endsWith(".json")).sort();
const maskUpdated = (s: string) => s.replace(/"updated":"[^"]*"/, '"updated":"X"');
const maskNums = (s: string) =>
    s.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m) => (m[0] === '"' ? m : "N"));

let exact = 0;
let structural = 0;
let different = 0;
const drift: Record<string, { n: number; changed: number; maxRel: number }> = {};

for (const f of files) {
    let ta: string;
    let tb: string;
    try {
        ta = readFileSync(join(a, f), "utf8");
        tb = readFileSync(join(b, f), "utf8");
    } catch {
        console.log("MISSING   ", f);
        different++;
        continue;
    }
    const ma = maskUpdated(ta);
    const mb = maskUpdated(tb);
    if (ma === mb) {
        exact++;
        console.log("EXACT     ", f, ta.length, "bytes");
        continue;
    }
    if (maskNums(ma) === maskNums(mb)) {
        structural++;
        const ja = JSON.parse(ta);
        const jb = JSON.parse(tb);
        let line = `STRUCTURAL ${f}`;
        if (ja.quotes) {
            const same = ja.quotes.every(
                (q: Record<string, unknown>, i: number) =>
                    q.symbol === jb.quotes[i]?.symbol &&
                    q.expiration === jb.quotes[i]?.expiration &&
                    q.greeksSource === jb.quotes[i]?.greeksSource &&
                    q.greeksMissingReason === jb.quotes[i]?.greeksMissingReason,
            );
            line += ` quotes=${ja.quotes.length}/${jb.quotes.length} sameSymbolsSourcesReasons=${same}`;
            line += ` spot=${ja.underlyingPrice}/${jb.underlyingPrice}`;
            line += JSON.stringify(ja.greeks) === JSON.stringify(jb.greeks) ? " greeks=identical" : ` greeks=${JSON.stringify(ja.greeks)} vs ${JSON.stringify(jb.greeks)}`;
            for (let i = 0; i < ja.quotes.length; i++) {
                for (const k of Object.keys(ja.quotes[i])) {
                    const x = ja.quotes[i][k];
                    const y = jb.quotes[i][k];
                    if (typeof x !== "number" && typeof y !== "number") continue;
                    const d = (drift[k] ??= { n: 0, changed: 0, maxRel: 0 });
                    d.n++;
                    if (x !== y) {
                        d.changed++;
                        if (typeof x === "number" && typeof y === "number" && x !== 0) d.maxRel = Math.max(d.maxRel, Math.abs(x - y) / Math.abs(x));
                    }
                }
            }
        }
        console.log(line);
        continue;
    }
    different++;
    const x = maskNums(ma);
    const y = maskNums(mb);
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    console.log("DIFFERENT ", f, "at", i, "\n  A:", x.slice(Math.max(0, i - 60), i + 80), "\n  B:", y.slice(Math.max(0, i - 60), i + 80));
}

console.log(`\nsummary: exact=${exact} structural-only=${structural} different=${different}`);
if (Object.keys(drift).length) {
    console.log("value drift per numeric quote field (compared / changed / max relative change):");
    for (const [k, d] of Object.entries(drift)) console.log(`  ${k.padEnd(14)} ${d.n} / ${d.changed} / ${d.maxRel.toExponential(2)}`);
}
process.exit(different ? 1 : 0);

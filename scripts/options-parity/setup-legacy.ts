// Seeds one working copy (arg: its root dir) for the "legacy" parity scenario: legacy index.json shape
// (files as a map plus `generated`), a legacy scripts/no_options.json, and cache files with a missing,
// empty, naive, offset or date-only `updated`, so the oldest-first ordering and the mtime fallback are exercised.
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const opt = join(dir, "data/options");
const idxPath = join(opt, "index.json");
const idx = JSON.parse(readFileSync(idxPath, "utf8"));
const filesMap: Record<string, string> = {};
for (const f of idx.files) filesMap[f] = "2026-10-01T00:00:00-04:00";
writeFileSync(idxPath, JSON.stringify({ generated: "2026-10-01T00:00:00Z", files: filesMap, count: idx.files.length, names: idx.names, no_options: {} }, null, 2) + "\n");
writeFileSync(join(dir, "scripts/no_options.json"), JSON.stringify({ ZZZZNOPE: "2026-10-01", OLDX: "2026-06-01", NEWX: "2026-10-07" }));

const touch = (sym: string, mut: (j: Record<string, unknown>) => void, mtime: number) => {
    const p = join(opt, `${sym}.json`);
    const j = JSON.parse(readFileSync(p, "utf8"));
    mut(j);
    writeFileSync(p, JSON.stringify(j));
    utimesSync(p, mtime, mtime);
};
touch("ABBV", (j) => delete j.updated, 1700000000);
touch("ADBE", (j) => (j.updated = "2020-01-01T00:00:00"), 1700000500);
touch("ADC", (j) => (j.updated = ""), 1700000900);
touch("ADI", (j) => (j.updated = "2020-01-01T00:00:00+05:30"), 1700001000);
touch("ADP", (j) => (j.updated = "2019-12-31"), 1700001000);

#!/usr/bin/env bun
/// <reference types="node" />
/// <reference types="bun" />
/**
 * Runs the browser checks (`src/*.e2e.ts`) of `bun run test:e2e`: the app is built ONCE, then the checks run side by side,
 * each in its own process with its own browser, its own copy of the build and its own port (src/e2e-site.ts), so none depends
 * on another. The output of a check is printed when it ends (not mixed with the others); the exit code is 1 when any failed.
 *   E2E_JOBS=1 bun src/e2e-run.ts      one at a time (to debug)
 *   bun src/e2e-run.ts custom-levels   only the checks whose file name contains that text
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = dirname(__dirname);
const filters = process.argv.slice(2);
const files = readdirSync(join(ROOT, "src"))
    .filter((f) => f.endsWith(".e2e.ts") && (!filters.length || filters.some((x) => f.includes(x))))
    .sort();
if (!files.length) {
    console.error("no e2e files match");
    process.exit(1);
}
const jobs = Math.max(1, Number(process.env.E2E_JOBS) || Math.min(4, cpus().length));

const started = performance.now();
const dist = mkdtempSync(join(tmpdir(), "gex-e2e-build-"));
console.log(`building the app once, then ${files.length} browser check(s), ${jobs} at a time`);
const build = Bun.spawn(["bunx", "parcel", "build", "--no-cache", "--no-source-maps", "--dist-dir", dist], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
async function main(): Promise<void> {
    if ((await build.exited) !== 0) {
        console.error("parcel build failed");
        process.exit(1);
    }

    interface Result { file: string; code: number; out: string; secs: number }
    const results: Result[] = [];
    let next = 0;
    async function worker(): Promise<void> {
        while (next < files.length) {
            const file = files[next++];
            const t = performance.now();
            const proc = Bun.spawn(["bun", join("src", file)], { cwd: ROOT, env: { ...process.env, E2E_BUILD: dist }, stdout: "pipe", stderr: "pipe" });
            const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
            const r: Result = { file, code: proc.exitCode ?? 1, out: (out + err).split("\n").filter((l) => !l.includes("/dev/tty")).join("\n").trim(), secs: (performance.now() - t) / 1000 };
            results.push(r);
            console.log(`${r.code === 0 ? "PASS" : "FAIL"} ${file} (${r.secs.toFixed(0)}s)`);
            if (r.code !== 0) console.log(r.out.split("\n").map((l) => `    ${l}`).join("\n"));
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
    rmSync(dist, { recursive: true, force: true });

    const failed = results.filter((r) => r.code !== 0);
    console.log(`\n${results.length - failed.length} passed, ${failed.length} failed in ${((performance.now() - started) / 1000).toFixed(0)}s`);
    if (failed.length) {
        console.log(`failed: ${failed.map((r) => r.file).join(", ")}`);
        process.exit(1);
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
});

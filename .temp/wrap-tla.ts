// Wraps the top-level-await part of each e2e script into `async function main()` (IDE TS1378 under module commonjs)
import { readFileSync, writeFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const lines = readFileSync(f, 'utf8').replace(/\n$/, '').split('\n');
  const start = lines.findIndex((l) => /^\S/.test(l) && !/^(import|\/\/|\/\*| \*)/.test(l) && /\bawait\b/.test(l) && !/^(async function|function|const \w+ = async)/.test(l));
  if (start < 0) { console.log('skip', f); continue; }
  // keep a leading comment block attached to the first wrapped line outside? no: wrap from start only
  const head = lines.slice(0, start);
  const body = lines.slice(start).map((l) => (l.length ? '    ' + l : l));
  const out = [...head, 'async function main(): Promise<void> {', ...body, '}', '', 'main().catch((err: unknown) => {', '    console.error(err);', '    process.exitCode = 1;', '});', ''];
  writeFileSync(f, out.join('\n'));
  console.log('wrapped', f, 'from line', start + 1, lines[start].slice(0, 60));
}

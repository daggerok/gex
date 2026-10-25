// `[...x]` (a single spread of a Set, Map, iterator or typed array) -> `Array.from(x)` on the given file:line pairs (IDE TS2802 at target ES5)
import { readFileSync, writeFileSync } from 'node:fs';
const byFile = new Map<string, number[]>();
for (const loc of process.argv.slice(2)) { const [f, n] = loc.split(':'); byFile.set(f, [...(byFile.get(f) ?? []), Number(n)]); }
for (const [f, nums] of byFile) {
  const lines = readFileSync(f, 'utf8').split('\n');
  for (const n of nums) {
    let s = lines[n - 1];
    let i = 0;
    while ((i = s.indexOf('[...', i)) >= 0) {
      let depth = 0, j = i, comma = false;
      for (; j < s.length; j++) {
        const c = s[j];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { depth--; if (depth === 0) break; }
        else if (c === ',' && depth === 1) comma = true;
      }
      if (!comma && j < s.length) { s = s.slice(0, i) + 'Array.from(' + s.slice(i + 4, j) + ')' + s.slice(j + 1); }
      i += 1;
    }
    lines[n - 1] = s;
  }
  writeFileSync(f, lines.join('\n'));
}

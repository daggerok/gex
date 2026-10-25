import { readFileSync, writeFileSync } from 'node:fs';
const files = readFileSync('.temp/files.txt', 'utf8').trim().split('\n').filter(f => f.startsWith('src/'));
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  if (/^\/\/\/ <reference /m.test(s.split('\n').slice(0, 5).join('\n'))) continue;
  const isTest = /\.(test|e2e)\.ts$/.test(f) || /e2e-/.test(f);
  const head = isTest ? '/// <reference types="bun" />\n/// <reference types="node" />\n' : '/// <reference lib="esnext" />\n';
  writeFileSync(f, head + s);
  console.log(f);
}

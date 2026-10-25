import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/axis-colors.ts';
let s = readFileSync(f, 'utf8');
const rep = (a: string, b: string) => { if (!s.includes(a)) throw new Error('missing: ' + a); s = s.replace(a, b); };
rep("type Colors = Readonly<Record<string, string>>;", "/** The metric colors the axes read: a `MetricColorSet` (an interface, so not assignable to an index-signature record) fits. */\ntype CountColors = { readonly callOi: string; readonly putOi: string; readonly callVolume: string; readonly putVolume: string };\ntype RatioColors = { readonly pcRatioOi: string; readonly pcRatioVolume: string };");
rep("export function countAxisColor(v: number, active: readonly string[], colors: Colors): string {\n    const call = ['callOi', 'callVolume'].find", "export function countAxisColor(v: number, active: readonly string[], colors: CountColors): string {\n    const call = (['callOi', 'callVolume'] as const).find");
rep("const put = ['putOi', 'putVolume'].find", "const put = (['putOi', 'putVolume'] as const).find");
rep("export function ratioAxisColor(active: readonly string[], colors: Colors): string {\n    const m = ['pcRatioOi', 'pcRatioVolume'].find", "export function ratioAxisColor(active: readonly string[], colors: RatioColors): string {\n    const m = (['pcRatioOi', 'pcRatioVolume'] as const).find");
writeFileSync(f, s);

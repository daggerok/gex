import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/views/GexView.tsx';
let s = readFileSync(f, 'utf8');
const a = `const coloredTick = (colorOf: (v: number) => string, format: (v: number) => string, placement?: { dx: number; anchor: 'start' | 'end' }) => (props: { x?: number; y?: number; payload?: { value: number }; textAnchor?: string }) => {
    const v = props.payload?.value;
    if (v == null || props.x == null || props.y == null) return <React.Fragment />;
    return (
        <text x={props.x + (placement?.dx ?? 0)} y={props.y}`;
const b = `const coloredTick = (colorOf: (v: number) => string, format: (v: number) => string, placement?: { dx: number; anchor: 'start' | 'end' }) => (props: { x?: number | string; y?: number | string; payload?: { value?: unknown }; textAnchor?: string }) => {
    // recharts types x and y as number | string: coerce, so the dx offset is never a string concatenation
    const v = props.payload?.value;
    const x = Number(props.x);
    const y = Number(props.y);
    if (typeof v !== 'number' || props.x == null || props.y == null || !Number.isFinite(x) || !Number.isFinite(y)) return <React.Fragment />;
    return (
        <text x={x + (placement?.dx ?? 0)} y={y}`;
if (!s.includes(a)) throw new Error('missing');
writeFileSync(f, s.replace(a, b));

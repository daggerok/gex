// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef, useState } from 'react';
import { isApplePlatform, LEVEL_PALETTE } from '../custom-levels';
import { useI18n } from '../i18n';
import { fmt } from '../utils';
import { Icon } from './Icon';

// ============================================================================
// CUSTOM LEVEL EDITOR - the small box that opens at the pointer on the Chart and
// GEX tabs (right click, a two-finger click on a trackpad, Ctrl+click on macOS) to
// name a new level or to rename, cancel or delete an existing one. Shared by both
// tabs so they behave the same. Enter or the check button saves, Esc or the crossed
// pencil cancels, the X deletes (existing levels only), leaving the box cancels.
// ============================================================================

export interface LevelDraft {
    /** pointer position inside the chart box, in px */
    x: number;
    y: number;
    price: number;
    name: string;
    /** `#rrggbb`: proposed at random for a new level, the level's own colour when editing */
    color: string;
    /** set when an existing level is being edited */
    editId?: string;
}

/** Platform of the viewer, read once: the buttons sit top left on macOS and iOS, top right elsewhere. */
const APPLE = isApplePlatform();

/** Icon button of the editor. */
const BTN = 'grid h-6 w-6 shrink-0 place-items-center rounded';

export const CustomLevelEditor: React.FC<{
    draft: LevelDraft;
    /** width of the chart box, so the editor stays inside it */
    boxWidth: number;
    onSave: (name: string, color: string) => void;
    onCancel: () => void;
    onDelete?: () => void;
}> = ({ draft, boxWidth, onSave, onCancel, onDelete }) => {
    const { t: tr } = useI18n();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [color, setColor] = useState(draft.color);
    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);
    const save = () => onSave((inputRef.current?.value ?? draft.name).trim() || draft.name, color);
    return (
        <div
            // focus moving between the input and its buttons keeps the editor open, leaving it closes it
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCancel(); }}
            onContextMenu={(e) => e.stopPropagation()}
            style={{ left: Math.max(0, Math.min(draft.x, (boxWidth || 240) - 240)), top: Math.max(0, draft.y - 16) }}
            className="absolute z-30 flex select-text flex-col gap-1 rounded-md border border-sky-400 bg-white p-1 shadow-lg dark:bg-slate-900"
        >
            {/* Buttons on top: right on Windows and Linux, left on macOS and iOS */}
            <div className={'flex items-center gap-1 ' + (APPLE ? 'justify-start' : 'justify-end')}>
                {/* onMouseDown keeps the focus in the input so the editor does not close before the click lands */}
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={save}
                        aria-label={tr('chart.custom.save')} title={tr('chart.custom.save')} className={BTN + ' text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-slate-800'}>
                    <Icon.Check className="h-4 w-4" />
                </button>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onCancel}
                        aria-label={tr('chart.custom.cancel')} title={tr('chart.custom.cancel')} className={BTN + ' text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}>
                    <Icon.PencilOff className="h-4 w-4" />
                </button>
                {draft.editId && onDelete && (
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onDelete}
                            aria-label={tr('chart.custom.delete')} title={tr('chart.custom.delete')} className={BTN + ' text-red-500 hover:bg-red-50 dark:hover:bg-slate-800'}>
                        <Icon.X className="h-4 w-4" />
                    </button>
                )}
            </div>
            <input
                ref={inputRef}
                type="text"
                defaultValue={draft.name}
                aria-label={tr('chart.custom.nameLabel', { price: fmt(draft.price) })}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); save(); }
                    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                }}
                spellCheck={false}
                maxLength={40}
                className="w-44 rounded px-1.5 py-0.5 text-sm font-medium text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-50"
            />
            {/* The colour: the proposed one is selected, a click on another circle or the colour field changes it. onMouseDown keeps the
                focus in the name field so the editor stays open. */}
            <div role="radiogroup" aria-label={tr('chart.custom.color')} className="flex w-44 flex-wrap items-center gap-1 px-1 pb-0.5">
                {LEVEL_PALETTE.map((c) => (
                    <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={c.toLowerCase() === color.toLowerCase()}
                        aria-label={c}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setColor(c); inputRef.current?.focus(); }}
                        style={{ backgroundColor: c }}
                        className={'h-4 w-4 shrink-0 rounded-full border ' + (c.toLowerCase() === color.toLowerCase() ? 'border-slate-900 ring-2 ring-sky-400 dark:border-white' : 'border-slate-300 dark:border-slate-600')}
                    />
                ))}
                <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    onKeyDown={(e) => {
                        // Enter and Esc work from the colour field too
                        if (e.key === 'Enter') { e.preventDefault(); save(); }
                        else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                    }}
                    aria-label={tr('chart.custom.colorPick')}
                    title={tr('chart.custom.colorPick')}
                    className="h-4 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-600"
                />
            </div>
        </div>
    );
};

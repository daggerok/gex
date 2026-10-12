// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import React, { useEffect, useRef } from 'react';
// @ts-ignore -- resolved by the Parcel/Bun build toolchain
import { createPortal } from 'react-dom';

/**
 * A plain modal: dark backdrop, a centered card, Esc and a click on the backdrop close it, focus goes into the card.
 * Rendered in a portal on document.body so no `overflow` ancestor clips it.
 */
export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; widthClass?: string; closeLabel?: string }> = ({ title, onClose, children, widthClass = 'max-w-lg', closeLabel = 'Close' }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
        window.addEventListener('keydown', onKey, true);
        const previous = document.activeElement as HTMLElement | null;
        cardRef.current?.focus();
        return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
    }, [onClose]);
    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                ref={cardRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className={`flex max-h-[90dvh] w-full ${widthClass} flex-col rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}
            >
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                    <h2 className="text-sm font-bold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label={closeLabel} className="rounded-md px-2 py-0.5 text-lg leading-none text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">×</button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
            </div>
        </div>,
        document.body,
    );
};

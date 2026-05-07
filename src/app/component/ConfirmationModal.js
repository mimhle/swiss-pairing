"use client";

import { Dialog, Portal } from '@skeletonlabs/skeleton-react';

/**
 * A reusable confirmation or alert modal that matches the application style.
 * 
 * @param {boolean} open - Whether the modal is visible
 * @param {function} onOpenChange - Callback when open state changes
 * @param {string} title - Modal title
 * @param {string} description - Modal description
 * @param {string} confirmText - Label for the confirmation button
 * @param {string} cancelText - Label for the cancel button
 * @param {function} onConfirm - Callback when confirmed
 * @param {string} variant - 'primary' or 'error' (affects confirm button color)
 * @param {boolean} isAlert - If true, hide the cancel button (acts like alert())
 * @param {Array} details - Optional collapsible detail rows
 */
export default function ConfirmationModal({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    onConfirm,
    variant = "primary",
    isAlert = false,
    details = []
}) {
    return (
        <Dialog open={open} onOpenChange={({ open }) => onOpenChange(open)}>
            <Portal>
                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]" />
                <Dialog.Positioner className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                    <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4 shadow-xl">
                        {title && <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>}
                        {description && (
                            <Dialog.Description className="text-sm text-surface-600-400">
                                {description}
                            </Dialog.Description>
                        )}
                        {details.length > 0 && (
                            <details className="rounded-lg border border-surface-200-800 bg-surface-50-950">
                                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                                    Skipped lines ({details.length})
                                </summary>
                                <div className="max-h-64 overflow-y-auto border-t border-surface-200-800 divide-y divide-surface-200-800">
                                    {details.map((detail, index) => (
                                        <div key={`${detail.line}-${index}`} className="px-3 py-2 space-y-1">
                                            <div className="flex items-center justify-between gap-3 text-xs">
                                                <span className="font-semibold">Line {detail.line}</span>
                                                <span className="text-surface-600-400 text-right">{detail.reason}</span>
                                            </div>
                                            <pre className="text-[11px] whitespace-pre-wrap break-words font-mono text-surface-700-300">
                                                {detail.raw}
                                            </pre>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                        <div className="flex justify-end gap-2">
                            {!isAlert && (
                                <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                    {cancelText}
                                </Dialog.CloseTrigger>
                            )}
                            <Dialog.CloseTrigger
                                className={`px-4 py-1.5 text-sm rounded ${variant === 'error' ? 'bg-error-500 hover:bg-error-600' : 'bg-primary-500 hover:bg-primary-600'} text-white transition-colors cursor-pointer`}
                                onClick={onConfirm}
                            >
                                {confirmText}
                            </Dialog.CloseTrigger>
                        </div>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog>
    );
}

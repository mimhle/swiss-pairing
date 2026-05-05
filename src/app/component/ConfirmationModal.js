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
    isAlert = false
}) {
    return (
        <Dialog open={open} onOpenChange={({ open }) => onOpenChange(open)}>
            <Portal>
                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
                <Dialog.Positioner className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-sm space-y-4 shadow-xl">
                        {title && <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>}
                        {description && (
                            <Dialog.Description className="text-sm text-surface-600-400">
                                {description}
                            </Dialog.Description>
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

"use client";

import { useState } from "react";
import { Dialog, Portal } from "@skeletonlabs/skeleton-react";
import { Cloud, Download, RefreshCw, Upload, AlertTriangle, Trash2, Database, X, Unplug } from "lucide-react";
import { clearAllData } from "@/lib/tournamentStore";
import { createBackupEnvelope, parseBackupJson, restoreBackupEnvelope } from "@/lib/backupData";
import { useDriveSync } from "@/context/DriveSyncContext";
import { DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY, DRIVE_ACCESS_TOKEN_KEY } from "@/lib/googleDriveBackup";
import ConfirmationModal from "./ConfirmationModal";

function formatDateTime(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Never";
    return date.toLocaleString();
}

export default function GlobalDataSettingsModal({ open, onOpenChange }) {
    const [modal, setModal] = useState({ open: false, title: "", description: "", onConfirm: null, isAlert: false, variant: "primary", confirmText: "Confirm" });
    const driveSync = useDriveSync();

    const showAlert = (title, description) => {
        setModal({ open: true, title, description, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: "primary", confirmText: "OK" });
    };

    const showConfirm = (title, description, onConfirm, variant = "primary", confirmText = "Confirm") => {
        setModal({ open: true, title, description, onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
    };

    const handleExport = async () => {
        let exportData;
        try {
            exportData = await createBackupEnvelope();
        } catch (_) {
            showAlert("Export Failed", "Failed to export database data.");
            return;
        }

        const blob = new Blob([JSON.stringify(exportData)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const date = new Date().toISOString().split("T")[0];
        a.download = `swiss-pairing-backup-${date}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = await parseBackupJson(event.target.result);

                showConfirm(
                    "Restore Backup?",
                    "Are you sure you want to restore this backup? This will OVERWRITE all current tournaments and data.",
                    async () => {
                        try {
                            await restoreBackupEnvelope(data);
                            showAlert("Success", "Backup restored successfully. The page will now reload.");
                            setTimeout(() => window.location.reload(), 1500);
                        } catch (_) {
                            showAlert("Restore Failed", "Failed to restore some database data.");
                        }
                    },
                    "primary",
                    "Restore"
                );
            } catch (err) {
                console.error("Import error:", err);
                showAlert(
                    err?.message === "Invalid backup file format." ? "Invalid Backup" : "Error",
                    err?.message === "Invalid backup file format." ? "Invalid backup file format." : "Error reading the backup file."
                );
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    };

    const handleDeleteAll = async () => {
        showConfirm(
            "Delete All Data?",
            "Are you ABSOLUTELY sure you want to delete all data? This will permanently remove all tournaments, players, mappings, and configuration. This action cannot be undone.",
            () => {
                showConfirm(
                    "Final Confirmation",
                    "Please confirm again: Delete ALL data forever?",
                    async () => {
                        localStorage.removeItem("swiss_tournaments");
                        localStorage.removeItem("swiss_active_tournament");
                        localStorage.removeItem("swiss_drive_sync_enabled");
                        localStorage.removeItem("swiss_drive_last_backup_at");
                        localStorage.removeItem("swiss_drive_last_known_hash");
                        localStorage.removeItem("swiss_drive_account_name");
                        localStorage.removeItem("swiss_drive_account_email");
                        localStorage.removeItem(DRIVE_ACCESS_TOKEN_KEY);
                        localStorage.removeItem(DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY);

                        const success = await clearAllData();
                        if (success) {
                            showAlert("Data Deleted", "All data has been deleted. The page will now reload.");
                            setTimeout(() => window.location.reload(), 1500);
                        } else {
                            showAlert("Error", "Failed to delete some database data.");
                        }
                    },
                    "error",
                    "Delete Everything"
                );
            },
            "error",
            "Yes, Delete All"
        );
    };

    return (
        <>
            <Dialog open={open} onOpenChange={({ open }) => onOpenChange(open)}>
                <Portal>
                    <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
                    <Dialog.Positioner className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-2xl space-y-5 shadow-xl max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <Dialog.Title className="text-lg font-bold flex items-center gap-2">
                                    <Database className="text-primary-500" size={20} />
                                    Page Data Settings
                                </Dialog.Title>
                                <Dialog.CloseTrigger className="p-1 hover:bg-surface-200-800 rounded transition-colors cursor-pointer">
                                    <X size={20} />
                                </Dialog.CloseTrigger>
                            </div>

                            <div className="grid gap-4">
                                <section className="bg-surface-50-950 border border-surface-200-800 rounded-lg p-4">
                                    <div className="mb-4">
                                        <h2 className="text-base font-semibold flex items-center gap-2">
                                            <Cloud className="text-primary-500" size={18} />
                                            Google Drive Sync
                                        </h2>
                                        <p className="text-sm text-surface-600-400 mt-1">
                                            Back up page data to your Google Drive app data folder and restore it on this device.
                                        </p>
                                    </div>

                                    {!driveSync.isConfigured ? (
                                        <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded text-warning-700 dark:text-warning-400 text-sm flex items-start gap-3">
                                            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                                            <div>
                                                <strong className="block font-semibold mb-0.5">Google Drive is not configured</strong>
                                                Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Drive backup and restore.
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid gap-2 text-sm text-surface-600-400">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-medium text-surface-950-50">Status:</span>
                                                    <span>{driveSync.statusMessage || (driveSync.isEnabled ? "Google Drive sync is enabled." : "Google Drive sync is disconnected.")}</span>
                                                </div>
                                                {(driveSync.connectedAccount.name || driveSync.connectedAccount.email) && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-medium text-surface-950-50">Account:</span>
                                                        <span>
                                                            {driveSync.connectedAccount.name}
                                                            {driveSync.connectedAccount.email && driveSync.connectedAccount.email !== driveSync.connectedAccount.name
                                                                ? ` (${driveSync.connectedAccount.email})`
                                                                : ""}
                                                        </span>
                                                    </div>
                                                )}
                                                <div>Last backup: {formatDateTime(driveSync.lastBackupAt)}</div>
                                                <div>Last check: {formatDateTime(driveSync.lastCheckAt)}</div>
                                                {driveSync.isEnabled && (
                                                    <div>Auto-backup: {driveSync.isConnected && !driveSync.needsReconnect ? "Every 1 minute" : "Paused until connected"}</div>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {!driveSync.isEnabled || !driveSync.isConnected || driveSync.needsReconnect ? (
                                                    <button
                                                        type="button"
                                                        onClick={driveSync.connect}
                                                        disabled={driveSync.isSyncing}
                                                        className="flex items-center gap-1.5 text-sm px-4 py-2 rounded bg-primary-500 hover:bg-primary-600 text-white cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <Cloud size={16} />
                                                        {driveSync.isSyncing ? "Connecting..." : "Connect Google Drive"}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={driveSync.disconnect}
                                                        disabled={driveSync.isSyncing}
                                                        className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-tonal cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <Unplug size={16} />
                                                        Disconnect
                                                    </button>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={driveSync.backupNow}
                                                    disabled={!driveSync.isEnabled || driveSync.isSyncing}
                                                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-tonal cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <Upload size={16} />
                                                    Back Up Now
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={driveSync.checkNow}
                                                    disabled={!driveSync.isEnabled || driveSync.isSyncing}
                                                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-tonal cursor-pointer font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <RefreshCw size={16} />
                                                    Check Drive Backup
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </section>

                                <section className="bg-surface-50-950 border border-surface-200-800 rounded-lg p-4">
                                    <div className="mb-4">
                                        <h2 className="text-base font-semibold flex items-center gap-2">
                                            <Download className="text-primary-500" size={18} />
                                            Export All Data
                                        </h2>
                                        <p className="text-sm text-surface-600-400 mt-1">
                                            Download a complete backup of all tournaments, players, mappings, and configuration.
                                        </p>
                                    </div>
                                    <button onClick={handleExport} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-filled-primary cursor-pointer font-medium">
                                        <Download size={16} />
                                        Export Backup
                                    </button>
                                </section>

                                <section className="bg-surface-50-950 border border-surface-200-800 rounded-lg p-4">
                                    <div className="mb-4">
                                        <h2 className="text-base font-semibold flex items-center gap-2">
                                            <Upload className="text-secondary-500" size={18} />
                                            Restore Backup
                                        </h2>
                                        <p className="text-sm text-surface-600-400 mt-1 mb-3">
                                            Upload a previously exported backup file to restore your data.
                                        </p>
                                        <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded text-warning-700 dark:text-warning-400 text-sm flex items-start gap-3">
                                            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                                            <div>
                                                <strong className="block font-semibold mb-0.5">Warning</strong>
                                                Restoring a backup overwrites the current page data.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative inline-block">
                                        <input type="file" accept=".json" onChange={handleImport} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" title="Upload backup file" />
                                        <button className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-tonal cursor-pointer font-medium">
                                            <Upload size={16} />
                                            Choose Backup File...
                                        </button>
                                    </div>
                                </section>

                                <section className="bg-error-50-950 border border-error-500/30 rounded-lg p-4">
                                    <div className="mb-4">
                                        <h2 className="text-base font-semibold flex items-center gap-2 text-error-600 dark:text-error-500">
                                            <Trash2 size={18} />
                                            Danger Zone
                                        </h2>
                                        <p className="text-sm text-surface-600-400 mt-1">
                                            Permanently delete all tournaments, players, and configuration data from this device.
                                        </p>
                                    </div>

                                    <button onClick={handleDeleteAll} className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-filled-error cursor-pointer font-medium">
                                        <Trash2 size={16} />
                                        Delete All Data
                                    </button>
                                </section>
                            </div>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog>

            <ConfirmationModal
                open={modal.open}
                onOpenChange={(open) => setModal(prev => ({ ...prev, open }))}
                title={modal.title}
                description={modal.description}
                onConfirm={modal.onConfirm}
                isAlert={modal.isAlert}
                variant={modal.variant}
                confirmText={modal.confirmText}
            />
        </>
    );
}

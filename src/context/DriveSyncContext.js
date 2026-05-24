"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Portal, Progress } from "@skeletonlabs/skeleton-react";
import { AlertTriangle, Check, Cloud, X } from "lucide-react";
import { createBackupEnvelope, getBackupHash, parseBackupJson, restoreBackupEnvelope } from "@/lib/backupData";
import { DATA_CHANGED_EVENT } from "@/lib/dataChangeSignal";
import {
    clearGoogleDriveToken,
    DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY,
    DRIVE_ACCESS_TOKEN_KEY,
    downloadDriveBackup,
    fetchGoogleAccountProfile,
    findDriveBackupFile,
    hasGoogleClientId,
    hasValidGoogleAccessToken,
    requestGoogleDriveToken,
    uploadDriveBackup,
} from "@/lib/googleDriveBackup";
import ConfirmationModal from "@/components/modals/ConfirmationModal";

const DriveSyncContext = createContext(null);

const SYNC_ENABLED_KEY = "swiss_drive_sync_enabled";
const LAST_BACKUP_AT_KEY = "swiss_drive_last_backup_at";
const LAST_KNOWN_HASH_KEY = "swiss_drive_last_known_hash";
const ACCOUNT_NAME_KEY = "swiss_drive_account_name";
const ACCOUNT_EMAIL_KEY = "swiss_drive_account_email";
const AUTO_BACKUP_CHANGE_DEBOUNCE_MS = 1500;
const AUTO_BACKUP_INTERVAL_MS = 60000;

function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
}

export function DriveSyncProvider({ children }) {
    const [isEnabled, setIsEnabled] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [lastBackupAt, setLastBackupAt] = useState("");
    const [lastCheckAt, setLastCheckAt] = useState("");
    const [connectedAccount, setConnectedAccount] = useState({ name: "", email: "" });
    const [backupIndicator, setBackupIndicator] = useState(null);
    const [backupProgress, setBackupProgress] = useState(0);
    const [modal, setModal] = useState({ open: false, title: "", description: "", isAlert: true, variant: "primary", confirmText: "OK", onConfirm: null });
    const [conflict, setConflict] = useState(null);
    const intervalRef = useRef(null);
    const pendingBackupTimeoutRef = useRef(null);
    const debounceProgressIntervalRef = useRef(null);
    const backupIndicatorTimeoutRef = useRef(null);
    const isConfigured = hasGoogleClientId();

    const stopAutoBackup = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const showBackupIndicator = useCallback((status, progress) => {
        setBackupIndicator(status);
        if (typeof progress === "number") setBackupProgress(Math.max(0, Math.min(100, progress)));
        if (backupIndicatorTimeoutRef.current) clearTimeout(backupIndicatorTimeoutRef.current);
        if (status !== "saving") {
            backupIndicatorTimeoutRef.current = setTimeout(() => setBackupIndicator(null), status === "saved" ? 1400 : 3000);
        }
    }, []);

    const clearDebounceProgress = useCallback(() => {
        if (debounceProgressIntervalRef.current) {
            clearInterval(debounceProgressIntervalRef.current);
            debounceProgressIntervalRef.current = null;
        }
    }, []);

    const startDebounceProgress = useCallback(() => {
        clearDebounceProgress();
        const startedAt = Date.now();
        showBackupIndicator("saving", 0);
        debounceProgressIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            const progress = Math.min(100, Math.round((elapsed / AUTO_BACKUP_CHANGE_DEBOUNCE_MS) * 100));
            setBackupProgress(progress);
            if (progress >= 100) clearDebounceProgress();
        }, 50);
    }, [clearDebounceProgress, showBackupIndicator]);

    const showAlert = useCallback((title, description, variant = "primary") => {
        setModal({
            open: true,
            title,
            description,
            isAlert: true,
            variant,
            confirmText: "OK",
            onConfirm: () => setModal(prev => ({ ...prev, open: false })),
        });
    }, []);

    const markBackupSaved = useCallback((backup) => {
        const now = new Date().toISOString();
        localStorage.setItem(LAST_BACKUP_AT_KEY, now);
        localStorage.setItem(LAST_KNOWN_HASH_KEY, backup.sourceHash);
        setLastBackupAt(now);
        setStatusMessage("Google Drive backup is up to date.");
    }, []);

    const setReconnectRequired = useCallback((message = "Connect Google Drive to resume sync.") => {
        stopAutoBackup();
        clearGoogleDriveToken();
        setIsConnected(false);
        setNeedsReconnect(true);
        setStatusMessage(message);
    }, [stopAutoBackup]);

    const ensureManualToken = useCallback(async () => {
        const hasRememberedAccount = Boolean(localStorage.getItem(ACCOUNT_EMAIL_KEY) || localStorage.getItem(ACCOUNT_NAME_KEY));
        await requestGoogleDriveToken({ prompt: hasValidGoogleAccessToken() || hasRememberedAccount ? "" : "consent" });
        const profile = await fetchGoogleAccountProfile();
        const nextAccount = {
            name: profile.name || profile.email || "Google account",
            email: profile.email || "",
        };
        localStorage.setItem(ACCOUNT_NAME_KEY, nextAccount.name);
        if (nextAccount.email) {
            localStorage.setItem(ACCOUNT_EMAIL_KEY, nextAccount.email);
        } else {
            localStorage.removeItem(ACCOUNT_EMAIL_KEY);
        }
        setConnectedAccount(nextAccount);
        setIsConnected(true);
        setNeedsReconnect(false);
    }, []);

    const backupToDrive = useCallback(async ({ silent = false } = {}) => {
        if (!isConfigured) {
            showAlert("Google Drive Not Configured", "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive sync.", "error");
            return false;
        }

        if (silent && !hasValidGoogleAccessToken()) {
            showBackupIndicator("error", 0);
            setReconnectRequired("Google Drive session expired. Connect again to resume auto-backup.");
            return false;
        }

        if (!silent) setIsSyncing(true);
        try {
            if (!silent) await ensureManualToken();

            const backup = await createBackupEnvelope();
            if (silent) {
                const lastKnownHash = localStorage.getItem(LAST_KNOWN_HASH_KEY);
                if (lastKnownHash && backup.sourceHash === lastKnownHash) {
                    setStatusMessage("Google Drive backup is up to date.");
                    setBackupIndicator(null);
                    setBackupProgress(0);
                    return true;
                }
                showBackupIndicator("saving", 100);
                setIsSyncing(true);
            }
            const existingFile = await findDriveBackupFile();
            await uploadDriveBackup(backup, existingFile?.id || "");
            markBackupSaved(backup);
            setLastCheckAt(new Date().toISOString());
            setConflict(null);

            if (!silent) {
                stopAutoBackup();
                intervalRef.current = setInterval(() => {
                    backupToDrive({ silent: true });
                }, AUTO_BACKUP_INTERVAL_MS);
            }

            if (silent) {
                showBackupIndicator("saved", 100);
            } else {
                showAlert("Backup Saved", "Your data was backed up to Google Drive.");
            }
            return true;
        } catch (error) {
            const message = error?.message || "Failed to back up to Google Drive.";
            if (silent) {
                showBackupIndicator("error", 0);
                setReconnectRequired(message);
            } else {
                showAlert("Backup Failed", message, "error");
            }
            return false;
        } finally {
            setIsSyncing(false);
        }
    }, [ensureManualToken, isConfigured, markBackupSaved, setReconnectRequired, showAlert, showBackupIndicator, stopAutoBackup]);

    const startAutoBackup = useCallback(() => {
        stopAutoBackup();
        intervalRef.current = setInterval(() => {
            backupToDrive({ silent: true });
        }, AUTO_BACKUP_INTERVAL_MS);
    }, [backupToDrive, stopAutoBackup]);

    const overwriteDriveWithLocal = useCallback(async (existingFileId = "") => {
        setIsSyncing(true);
        try {
            await ensureManualToken();
            const backup = await createBackupEnvelope();
            await uploadDriveBackup(backup, existingFileId);
            markBackupSaved(backup);
            setConflict(null);
            startAutoBackup();
            showAlert("Drive Backup Updated", "This device's data is now the Google Drive backup.");
            return true;
        } catch (error) {
            showAlert("Backup Failed", error?.message || "Failed to update the Google Drive backup.", "error");
            return false;
        } finally {
            setIsSyncing(false);
        }
    }, [ensureManualToken, markBackupSaved, showAlert, startAutoBackup]);

    const restoreFromDrive = useCallback(async (remoteData) => {
        setIsSyncing(true);
        try {
            await restoreBackupEnvelope(remoteData);
            localStorage.setItem(LAST_KNOWN_HASH_KEY, remoteData.sourceHash || await getBackupHash(remoteData));
            const restoredAt = remoteData.createdAt || new Date().toISOString();
            localStorage.setItem(LAST_BACKUP_AT_KEY, restoredAt);
            setLastBackupAt(restoredAt);
            showAlert("Backup Restored", "Google Drive backup restored successfully. The page will now reload.");
            setTimeout(() => window.location.reload(), 1500);
            return true;
        } catch (error) {
            showAlert("Restore Failed", error?.message || "Failed to restore the Google Drive backup.", "error");
            return false;
        } finally {
            setIsSyncing(false);
        }
    }, [showAlert]);

    const checkDriveBackup = useCallback(async ({ manual = false } = {}) => {
        if (!isConfigured) {
            showAlert("Google Drive Not Configured", "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive sync.", "error");
            return false;
        }

        stopAutoBackup();
        setIsSyncing(true);
        try {
            await ensureManualToken();
            const localBackup = await createBackupEnvelope();
            const remoteFile = await findDriveBackupFile();
            const checkedAt = new Date().toISOString();
            setLastCheckAt(checkedAt);

            if (!remoteFile) {
                await uploadDriveBackup(localBackup);
                markBackupSaved(localBackup);
                startAutoBackup();
                if (manual) showAlert("Backup Created", "No Drive backup existed, so this device was backed up to Google Drive.");
                else showBackupIndicator("saved", 100);
                return true;
            }

            const remoteData = await parseBackupJson(await downloadDriveBackup(remoteFile.id));
            const remoteHash = remoteData.sourceHash || await getBackupHash(remoteData);

            if (localBackup.sourceHash === remoteHash) {
                localStorage.setItem(LAST_KNOWN_HASH_KEY, localBackup.sourceHash);
                setStatusMessage("Local and Google Drive data match.");
                startAutoBackup();
                if (manual) showAlert("Already Up To Date", "Local data and the Google Drive backup match.");
                return true;
            }

            setConflict({
                remoteData: { ...remoteData, sourceHash: remoteHash },
                remoteFile,
                remoteModifiedTime: remoteFile.modifiedTime,
                localHash: localBackup.sourceHash,
                remoteHash,
            });
            setStatusMessage("Local data differs from the Google Drive backup. Choose which copy to keep.");
            return false;
        } catch (error) {
            const message = error?.message || "Failed to check Google Drive backup.";
            showAlert("Drive Check Failed", message, "error");
            setStatusMessage(message);
            return false;
        } finally {
            setIsSyncing(false);
        }
    }, [ensureManualToken, isConfigured, markBackupSaved, showAlert, showBackupIndicator, startAutoBackup, stopAutoBackup]);

    const connect = useCallback(async () => {
        if (!isConfigured) {
            showAlert("Google Drive Not Configured", "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID to enable Google Drive sync.", "error");
            return false;
        }

        localStorage.setItem(SYNC_ENABLED_KEY, "true");
        setIsEnabled(true);
        setStatusMessage("Checking Google Drive backup...");
        return checkDriveBackup({ manual: false });
    }, [checkDriveBackup, isConfigured, showAlert]);

    const disconnect = useCallback(() => {
        stopAutoBackup();
        clearGoogleDriveToken();
        localStorage.removeItem(SYNC_ENABLED_KEY);
        localStorage.removeItem(DRIVE_ACCESS_TOKEN_KEY);
        localStorage.removeItem(DRIVE_ACCESS_TOKEN_EXPIRES_AT_KEY);
        localStorage.removeItem(ACCOUNT_NAME_KEY);
        localStorage.removeItem(ACCOUNT_EMAIL_KEY);
        setIsEnabled(false);
        setIsConnected(false);
        setNeedsReconnect(false);
        setConnectedAccount({ name: "", email: "" });
        setConflict(null);
        setStatusMessage("Google Drive sync is disconnected.");
    }, [stopAutoBackup]);

    useEffect(() => {
        const enabled = localStorage.getItem(SYNC_ENABLED_KEY) === "true";
        setIsEnabled(enabled);
        setLastBackupAt(localStorage.getItem(LAST_BACKUP_AT_KEY) || "");
        setConnectedAccount({
            name: localStorage.getItem(ACCOUNT_NAME_KEY) || "",
            email: localStorage.getItem(ACCOUNT_EMAIL_KEY) || "",
        });
        if (enabled) {
            if (isConfigured && hasValidGoogleAccessToken()) {
                setIsConnected(true);
                setNeedsReconnect(false);
                setStatusMessage("Checking Google Drive backup...");
                checkDriveBackup({ manual: false });
            } else {
                setNeedsReconnect(true);
                setStatusMessage("Connect Google Drive to resume sync.");
            }
        }

        return () => {
            stopAutoBackup();
            if (pendingBackupTimeoutRef.current) clearTimeout(pendingBackupTimeoutRef.current);
            clearDebounceProgress();
            if (backupIndicatorTimeoutRef.current) clearTimeout(backupIndicatorTimeoutRef.current);
        };
    }, [checkDriveBackup, clearDebounceProgress, isConfigured, stopAutoBackup]);

    useEffect(() => {
        if (!isEnabled || !isConnected || needsReconnect || !isConfigured) return;

        const handleDataChanged = () => {
            if (!hasValidGoogleAccessToken()) {
                showBackupIndicator("error", 0);
                setReconnectRequired("Google Drive session expired. Connect again to resume auto-backup.");
                return;
            }

            startDebounceProgress();
            if (pendingBackupTimeoutRef.current) clearTimeout(pendingBackupTimeoutRef.current);
            pendingBackupTimeoutRef.current = setTimeout(() => {
                pendingBackupTimeoutRef.current = null;
                clearDebounceProgress();
                setBackupProgress(100);
                backupToDrive({ silent: true });
            }, AUTO_BACKUP_CHANGE_DEBOUNCE_MS);
        };

        window.addEventListener(DATA_CHANGED_EVENT, handleDataChanged);
        return () => {
            window.removeEventListener(DATA_CHANGED_EVENT, handleDataChanged);
            if (pendingBackupTimeoutRef.current) {
                clearTimeout(pendingBackupTimeoutRef.current);
                pendingBackupTimeoutRef.current = null;
            }
            clearDebounceProgress();
        };
    }, [backupToDrive, clearDebounceProgress, isConfigured, isConnected, isEnabled, needsReconnect, setReconnectRequired, showBackupIndicator, startDebounceProgress]);

    const value = useMemo(() => ({
        isConfigured,
        isEnabled,
        isConnected,
        needsReconnect,
        isSyncing,
        statusMessage,
        lastBackupAt,
        lastCheckAt,
        connectedAccount,
        connect,
        disconnect,
        backupNow: () => backupToDrive({ silent: false }),
        checkNow: () => checkDriveBackup({ manual: true }),
    }), [
        backupToDrive,
        checkDriveBackup,
        connectedAccount,
        connect,
        disconnect,
        isConfigured,
        isConnected,
        isEnabled,
        isSyncing,
        lastBackupAt,
        lastCheckAt,
        needsReconnect,
        statusMessage,
    ]);

    return (
        <DriveSyncContext.Provider value={value}>
            {children}

            {isEnabled && needsReconnect && isConfigured && (
                <div className="fixed bottom-4 right-4 z-[90] w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-surface-200-800 bg-surface-100-900 shadow-xl p-4">
                    <div className="flex items-start gap-3">
                        <Cloud size={20} className="text-primary-500 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Google Drive sync paused</p>
                            <p className="text-xs text-surface-600-400 mt-1">Connect Google Drive to check for remote changes and resume auto-backup.</p>
                            <button
                                type="button"
                                onClick={connect}
                                disabled={isSyncing}
                                className="mt-3 px-3 py-1.5 rounded bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSyncing ? "Connecting..." : "Connect Google Drive"}
                            </button>
                        </div>
                        <button type="button" onClick={() => setNeedsReconnect(false)} className="p-1 rounded hover:bg-surface-200-800 cursor-pointer" aria-label="Dismiss Google Drive prompt">
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {backupIndicator && (
                <div
                    className={`fixed right-4 z-[220] flex h-9 w-9 items-center justify-center rounded-full border border-surface-200-800 bg-surface-100-900 text-surface-900-100 shadow-lg ${isEnabled && needsReconnect && isConfigured ? "bottom-36" : "bottom-4"}`}
                    role="status"
                    aria-live="polite"
                    aria-label={backupIndicator === "saving" ? `Google Drive backup timer, ${backupProgress}%` : backupIndicator === "saved" ? "Google Drive backup saved" : "Google Drive backup failed"}
                >
                    {backupIndicator === "saving" && (
                        <Progress value={backupProgress} className="h-6 w-6">
                            <Progress.Circle className="[--size:1.5rem] [--thickness:0.18rem]">
                                <Progress.CircleTrack />
                                <Progress.CircleRange />
                            </Progress.Circle>
                        </Progress>
                    )}
                    {backupIndicator === "saved" && <Check size={16} className="text-success-500" />}
                    {backupIndicator === "error" && <AlertTriangle size={15} className="text-error-500" />}
                </div>
            )}

            <Dialog open={Boolean(conflict)} onOpenChange={({ open }) => !open && setConflict(null)}>
                <Portal>
                    <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]" />
                    <Dialog.Positioner className="fixed inset-0 z-[210] flex items-center justify-center p-4">
                        <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-lg space-y-4 shadow-xl">
                            <Dialog.Title className="text-base font-semibold flex items-center gap-2">
                                <AlertTriangle size={18} className="text-warning-500" />
                                Google Drive Backup Differs
                            </Dialog.Title>
                            <Dialog.Description className="text-sm text-surface-600-400">
                                This device and Google Drive have different backup data. Auto-backup is paused until you choose which copy to keep.
                            </Dialog.Description>
                            <div className="rounded-lg border border-surface-200-800 bg-surface-50-950 p-3 text-xs text-surface-600-400 space-y-1">
                                <div>Drive modified: {formatDateTime(conflict?.remoteModifiedTime) || "Unknown"}</div>
                                <div>Local hash: {conflict?.localHash?.slice(0, 12)}...</div>
                                <div>Drive hash: {conflict?.remoteHash?.slice(0, 12)}...</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setConflict(null)}
                                    className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer"
                                >
                                    Decide Later
                                </button>
                                <button
                                    type="button"
                                    onClick={() => overwriteDriveWithLocal(conflict?.remoteFile?.id || "")}
                                    disabled={isSyncing}
                                    className="px-4 py-1.5 text-sm rounded preset-filled-primary cursor-pointer disabled:opacity-50"
                                >
                                    Keep This Device
                                </button>
                                <button
                                    type="button"
                                    onClick={() => restoreFromDrive(conflict?.remoteData)}
                                    disabled={isSyncing}
                                    className="px-4 py-1.5 text-sm rounded bg-warning-500 hover:bg-warning-600 text-white cursor-pointer disabled:opacity-50"
                                >
                                    Restore From Drive
                                </button>
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
        </DriveSyncContext.Provider>
    );
}

export function useDriveSync() {
    const context = useContext(DriveSyncContext);
    if (!context) {
        throw new Error("useDriveSync must be used within DriveSyncProvider");
    }
    return context;
}

"use client";

import { useState } from "react";
import { useTournament } from "@/app/context/TournamentContext";
import { exportAllData, importAllData, clearAllData } from "@/app/component/indexedDbPlayers";
import { Download, Upload, AlertTriangle, Trash2 } from 'lucide-react';
import ConfirmationModal from "./ConfirmationModal";

export default function SettingsTab() {
    const { tournaments } = useTournament();
    const [modal, setModal] = useState({ open: false, title: '', description: '', onConfirm: null, isAlert: false, variant: 'primary', confirmText: 'Confirm' });

    const showAlert = (title, description) => {
        setModal({ open: true, title, description, onConfirm: () => setModal(prev => ({ ...prev, open: false })), isAlert: true, variant: 'primary', confirmText: 'OK' });
    };

    const showConfirm = (title, description, onConfirm, variant = 'primary', confirmText = 'Confirm') => {
        setModal({ open: true, title, description, onConfirm: () => { onConfirm(); setModal(prev => ({ ...prev, open: false })); }, isAlert: false, variant, confirmText });
    };

    const handleExport = async () => {
        const idbData = await exportAllData();
        if (!idbData) {
            showAlert("Export Failed", "Failed to export database data.");
            return;
        }

        const exportData = {
            version: 1,
            localStorage: {
                swiss_tournaments: localStorage.getItem("swiss_tournaments"),
                swiss_active_tournament: localStorage.getItem("swiss_active_tournament")
            },
            indexedDB: idbData
        };

        const blob = new Blob([JSON.stringify(exportData)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
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
                const data = JSON.parse(event.target.result);
                if (!data.version || !data.localStorage || !data.indexedDB) {
                    showAlert("Invalid Backup", "Invalid backup file format.");
                    return;
                }

                showConfirm(
                    "Restore Backup?", 
                    "Are you sure you want to restore this backup? This will OVERWRITE all current tournaments and data.",
                    async () => {
                        // Restore localStorage
                        if (data.localStorage.swiss_tournaments) {
                            localStorage.setItem("swiss_tournaments", data.localStorage.swiss_tournaments);
                        }
                        if (data.localStorage.swiss_active_tournament) {
                            localStorage.setItem("swiss_active_tournament", data.localStorage.swiss_active_tournament);
                        }

                        // Restore IndexedDB
                        const success = await importAllData(data.indexedDB);
                        if (success) {
                            showAlert("Success", "Backup restored successfully. The page will now reload.");
                            setTimeout(() => window.location.reload(), 1500);
                        } else {
                            showAlert("Restore Failed", "Failed to restore some database data.");
                        }
                    },
                    'primary',
                    'Restore'
                );

            } catch (err) {
                console.error("Import error:", err);
                showAlert("Error", "Error reading the backup file.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset file input
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
                        // Clear localStorage
                        localStorage.removeItem("swiss_tournaments");
                        localStorage.removeItem("swiss_active_tournament");

                        // Clear IndexedDB
                        const success = await clearAllData();
                        if (success) {
                            showAlert("Data Deleted", "All data has been deleted. The page will now reload.");
                            setTimeout(() => window.location.reload(), 1500);
                        } else {
                            showAlert("Error", "Failed to delete some database data.");
                        }
                    },
                    'error',
                    'Delete Everything'
                );
            },
            'error',
            'Yes, Delete All'
        );
    };

    return (
        <div className="pb-8 space-y-6">
            <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6">
                <div className="mb-6">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                        <Download className="text-primary-500" size={18} />
                        Export All Data
                    </h2>
                    <p className="text-sm text-surface-600-400 mt-1">
                        Download a complete backup of all your tournaments, players, mappings, and configuration. Keep this file safe.
                    </p>
                </div>
                <button 
                    onClick={handleExport}
                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-filled-primary cursor-pointer font-medium"
                >
                    <Download size={16} />
                    Export Backup
                </button>
            </div>

            <div className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6">
                <div className="mb-6">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                        <Upload className="text-secondary-500" size={18} />
                        Restore Backup
                    </h2>
                    <p className="text-sm text-surface-600-400 mt-1 mb-4">
                        Upload a previously exported backup file to restore your data.
                    </p>
                    <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded text-warning-700 dark:text-warning-400 text-sm flex items-start gap-3">
                        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                        <div>
                            <strong className="block font-semibold mb-0.5">Warning</strong>
                            Restoring a backup will overwrite all current data. Any tournaments not included in the backup will be lost permanently.
                        </div>
                    </div>
                </div>
                
                <div className="relative inline-block">
                    <input 
                        type="file" 
                        accept=".json" 
                        onChange={handleImport}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        title="Upload backup file"
                    />
                    <button className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-tonal cursor-pointer font-medium">
                        <Upload size={16} />
                        Choose Backup File...
                    </button>
                </div>
            </div>

            <div className="bg-error-50-950 border border-error-500/30 rounded-lg p-6">
                <div className="mb-6">
                    <h2 className="text-base font-semibold flex items-center gap-2 text-error-600 dark:text-error-500">
                        <Trash2 size={18} />
                        Danger Zone
                    </h2>
                    <p className="text-sm text-surface-600-400 mt-1">
                        Permanently delete all tournaments, players, and configuration data from this device. This action cannot be undone.
                    </p>
                </div>
                
                <button 
                    onClick={handleDeleteAll}
                    className="flex items-center gap-1.5 text-sm px-4 py-2 rounded preset-filled-error cursor-pointer font-medium"
                >
                    <Trash2 size={16} />
                    Delete All Data
                </button>
            </div>

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
        </div>
    );
}

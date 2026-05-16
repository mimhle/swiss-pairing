"use client";

import { useState, Fragment } from "react";
import { useTournament } from "@/context/TournamentContext";
import { Dialog, Menu, Portal } from '@skeletonlabs/skeleton-react';
import { ChevronDown, Plus, Copy, Edit2, Trash2, Database } from 'lucide-react';
import GlobalDataSettingsModal from "@/components/modals/GlobalDataSettingsModal";

const normalizeTournamentName = (name) => String(name || '').trim().toLowerCase();

export default function TournamentSelector() {
    const {
        tournaments,
        activeTournamentId,
        setActiveTournamentId,
        addTournament,
        renameTournament,
        duplicateTournament,
        deleteTournament,
        isLoaded
    } = useTournament();

    const [modalConfig, setModalConfig] = useState({ isOpen: false, type: '', id: '', defaultValue: '' });
    const [dataSettingsOpen, setDataSettingsOpen] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const normalizedInputValue = normalizeTournamentName(inputValue);
    const duplicateCheckIgnoredId = modalConfig.type === 'rename' ? modalConfig.id : '';
    const isNameDuplicate = modalConfig.type !== 'delete' && normalizedInputValue
        ? tournaments.some(t => t.id !== duplicateCheckIgnoredId && normalizeTournamentName(t.name) === normalizedInputValue)
        : false;

    const openModal = (type, id = '', defaultValue = '') => {
        setInputValue(defaultValue);
        setModalConfig({ isOpen: true, type, id, defaultValue });
    };

    const closeModal = () => {
        setModalConfig({ isOpen: false, type: '', id: '', defaultValue: '' });
        setInputValue('');
    };

    const handleModalSubmit = async (e) => {
        e.preventDefault();
        const { type, id } = modalConfig;
        const val = inputValue.trim();
        if (!val && type !== 'delete') return;
        if (isNameDuplicate) return;

        if (type === 'add') {
            addTournament(val);
        } else if (type === 'rename') {
            renameTournament(id, val);
        } else if (type === 'duplicate') {
            await duplicateTournament(id, val);
        } else if (type === 'delete') {
            await deleteTournament(id);
        }
        closeModal();
    };

    const activeTournament = tournaments.find(t => t.id === activeTournamentId);

    return (
        <>
            <div className="flex items-center gap-3 py-2 mb-2">
                <h1 className="h2">Tournament:</h1>
                {isLoaded && activeTournament && (
                    <Menu>
                        <Menu.Trigger className="flex items-center gap-2 px-4 py-2 rounded preset-tonal hover:preset-tonal font-medium text-base cursor-pointer">
                            <span className="max-w-64 truncate">{activeTournament.name}</span>
                            <ChevronDown size={16} />
                        </Menu.Trigger>
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-56 z-50">
                                    <div className="px-3 py-2 text-xs font-bold text-surface-400-600 uppercase tracking-wider">
                                        Switch Tournament
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {tournaments.map(t => (
                                            <Fragment key={t.id}>
                                                <Menu.Item
                                                    value={t.id}
                                                    className={`px-3 py-2 rounded text-sm cursor-pointer transition-colors ${t.id === activeTournamentId ? 'preset-tonal-primary font-medium' : 'hover:bg-surface-200-800'}`}
                                                    onClick={() => setActiveTournamentId(t.id)}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className="truncate">{t.name}</span>
                                                        {t.id === activeTournamentId && <span className="w-2 h-2 rounded-full bg-primary-500"></span>}
                                                    </div>
                                                </Menu.Item>
                                            </Fragment>
                                        ))}
                                    </div>

                                    <Menu.Separator className="my-1 border-surface-200-800" />

                                    <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:bg-surface-200-800 flex items-center gap-2" onClick={() => openModal('add')}>
                                        <Plus size={14} /> New Tournament
                                    </Menu.Item>
                                    {activeTournamentId !== 'default' && (
                                        <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:bg-surface-200-800 flex items-center gap-2" onClick={() => openModal('rename', activeTournamentId, activeTournament.name)}>
                                            <Edit2 size={14} /> Rename Current
                                        </Menu.Item>
                                    )}
                                    <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:bg-surface-200-800 flex items-center gap-2" onClick={() => openModal('duplicate', activeTournamentId, `${activeTournament.name} (Copy)`)}>
                                        <Copy size={14} /> Duplicate Current
                                    </Menu.Item>
                                    {tournaments.length > 1 && activeTournamentId !== 'default' && (
                                        <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:preset-tonal-error flex items-center gap-2 text-error-500" onClick={() => openModal('delete', activeTournamentId)}>
                                            <Trash2 size={14} /> Delete Current
                                        </Menu.Item>
                                    )}
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu>
                )}
                <button
                    type="button"
                    onClick={() => setDataSettingsOpen(true)}
                    className="ml-auto p-2 rounded preset-tonal cursor-pointer"
                    title="Page data settings"
                    aria-label="Page data settings"
                >
                    <Database size={18} />
                </button>
            </div>

            <Dialog open={modalConfig.isOpen} onOpenChange={({ open }) => !open && closeModal()}>
                <Portal>
                    <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" />
                    <Dialog.Positioner className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                        <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full max-w-md space-y-4 shadow-xl">
                            <Dialog.Title className="text-base font-semibold">
                                {modalConfig.type === 'add' && 'Create New Tournament'}
                                {modalConfig.type === 'rename' && 'Rename Tournament'}
                                {modalConfig.type === 'duplicate' && 'Duplicate Tournament'}
                                {modalConfig.type === 'delete' && 'Delete Tournament'}
                            </Dialog.Title>

                            <form onSubmit={handleModalSubmit} className="space-y-4">
                                {modalConfig.type === 'delete' ? (
                                    <Dialog.Description className="text-sm text-surface-600-400">
                                        Are you sure you want to delete this tournament? This action cannot be undone and will permanently remove all players, mappings, and configuration.
                                    </Dialog.Description>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-surface-600-400">Tournament Name</label>
                                            <input
                                                type="text"
                                                className={`input text-sm ${isNameDuplicate ? 'border-error-500 focus:border-error-500 focus:ring-error-500' : ''}`}
                                                value={inputValue}
                                                onChange={(e) => setInputValue(e.target.value)}
                                                placeholder="Enter tournament name..."
                                                aria-invalid={isNameDuplicate}
                                                aria-describedby={isNameDuplicate ? "tournament-name-error" : undefined}
                                                autoFocus
                                                required
                                            />
                                            {isNameDuplicate && (
                                                <p id="tournament-name-error" className="text-xs text-error-500">
                                                    A tournament with this name already exists.
                                                </p>
                                            )}
                                        </div>
                                        {modalConfig.type === 'duplicate' && (
                                            <p className="text-xs text-surface-500-400">
                                                This will copy all players, mappings, and card configurations to the new tournament.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end gap-2 pt-2">
                                    <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                        Cancel
                                    </Dialog.CloseTrigger>
                                    <button
                                        type="submit"
                                        disabled={isNameDuplicate}
                                        className={`px-4 py-1.5 text-sm rounded ${modalConfig.type === 'delete' ? 'bg-error-500 hover:bg-error-600' : 'bg-primary-500 hover:bg-primary-600'} text-white transition-colors cursor-pointer font-medium disabled:cursor-not-allowed disabled:opacity-50`}
                                    >
                                        {modalConfig.type === 'delete' ? 'Delete' : 'Save'}
                                    </button>
                                </div>
                            </form>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog>

            <GlobalDataSettingsModal open={dataSettingsOpen} onOpenChange={setDataSettingsOpen} />
        </>
    );
}

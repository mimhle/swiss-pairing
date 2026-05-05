"use client";

import { useState, Fragment } from "react";
import { useTournament } from "@/app/context/TournamentContext";
import { Menu, Portal } from '@skeletonlabs/skeleton-react';
import { ChevronDown, Plus, Copy, Edit2, Trash2 } from 'lucide-react';

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
    const [inputValue, setInputValue] = useState('');

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
            <div className="flex items-center gap-4 py-2 mb-2">
                <h1 className="h2">Tournament:</h1>
                {isLoaded && activeTournament && (
                    <Menu>
                        <Menu.Trigger className="flex items-center gap-2 px-4 py-2 rounded preset-tonal hover:preset-filled transition-colors font-medium text-base cursor-pointer">
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
                                    <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:bg-surface-200-800 flex items-center gap-2" onClick={() => openModal('rename', activeTournamentId, activeTournament.name)}>
                                        <Edit2 size={14} /> Rename Current
                                    </Menu.Item>
                                    <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:bg-surface-200-800 flex items-center gap-2" onClick={() => openModal('duplicate', activeTournamentId, `${activeTournament.name} (Copy)`)}>
                                        <Copy size={14} /> Duplicate Current
                                    </Menu.Item>
                                    {tournaments.length > 1 && (
                                        <Menu.Item className="px-3 py-2 rounded text-sm cursor-pointer hover:preset-tonal-error flex items-center gap-2 text-error-500" onClick={() => openModal('delete', activeTournamentId)}>
                                            <Trash2 size={14} /> Delete Current
                                        </Menu.Item>
                                    )}
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu>
                )}
            </div>

            {modalConfig.isOpen && (
                <Portal>
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/50 backdrop-blur-sm p-4">
                        <div className="bg-surface-100-900 rounded-lg shadow-xl w-full max-w-md border border-surface-200-800 p-6 animate-in fade-in zoom-in-95 duration-200">
                            <h3 className="h3 mb-4">
                                {modalConfig.type === 'add' && 'Create New Tournament'}
                                {modalConfig.type === 'rename' && 'Rename Tournament'}
                                {modalConfig.type === 'duplicate' && 'Duplicate Tournament'}
                                {modalConfig.type === 'delete' && 'Delete Tournament'}
                            </h3>

                            <form onSubmit={handleModalSubmit}>
                                {modalConfig.type === 'delete' ? (
                                    <p className="text-surface-600-400 mb-6">
                                        Are you sure you want to delete this tournament? This action cannot be undone and will permanently remove all players, mappings, and configuration.
                                    </p>
                                ) : (
                                    <div className="mb-6">
                                        <label className="block text-sm font-medium text-surface-600-400 mb-2">Tournament Name</label>
                                        <input
                                            type="text"
                                            className="input"
                                            value={inputValue}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            placeholder="Enter tournament name..."
                                            autoFocus
                                            required
                                        />
                                        {modalConfig.type === 'duplicate' && (
                                            <p className="text-xs text-surface-500 mt-2">
                                                This will copy all players, mappings, and card configurations to the new tournament.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="flex justify-end gap-3">
                                    <button type="button" className="btn preset-tonal" onClick={closeModal}>
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className={`btn ${modalConfig.type === 'delete' ? 'preset-filled-error' : 'preset-filled-primary'}`}
                                    >
                                        {modalConfig.type === 'delete' ? 'Delete' : 'Save'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </Portal>
            )}
        </>
    );
}

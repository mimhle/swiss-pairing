"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { duplicateTournamentData, deleteTournamentData } from "@/app/component/indexedDbPlayers";

const TournamentContext = createContext();

export function TournamentProvider({ children }) {
    const [tournaments, setTournaments] = useState([]);
    const [activeTournamentId, setActiveTournamentId] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        // Load from local storage
        const stored = localStorage.getItem("swiss_tournaments");
        let parsed = [];
        if (stored) {
            try {
                parsed = JSON.parse(stored);
            } catch (e) {}
        }
        
        if (parsed.length === 0) {
            parsed = [{ id: "default", name: "Default Tournament", createdAt: Date.now() }];
        }
        
        setTournaments(parsed);
        
        const active = localStorage.getItem("swiss_active_tournament");
        if (active && parsed.some(t => t.id === active)) {
            setActiveTournamentId(active);
        } else {
            setActiveTournamentId(parsed[0].id);
        }
        setIsLoaded(true);
    }, []);

    useEffect(() => {
        if (!isLoaded) return;
        localStorage.setItem("swiss_tournaments", JSON.stringify(tournaments));
    }, [tournaments, isLoaded]);

    useEffect(() => {
        if (!isLoaded || !activeTournamentId) return;
        localStorage.setItem("swiss_active_tournament", activeTournamentId);
    }, [activeTournamentId, isLoaded]);

    const addTournament = (name) => {
        const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        const newTournament = { id, name, createdAt: Date.now() };
        setTournaments(prev => [...prev, newTournament]);
        setActiveTournamentId(id);
    };

    const renameTournament = (id, newName) => {
        setTournaments(prev => prev.map(t => t.id === id ? { ...t, name: newName } : t));
    };

    const duplicateTournament = async (id, newName) => {
        const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        const newTournament = { id: newId, name: newName, createdAt: Date.now() };
        
        // Await IndexedDB copy
        await duplicateTournamentData(id, newId);
        
        setTournaments(prev => [...prev, newTournament]);
        setActiveTournamentId(newId);
    };

    const deleteTournament = async (id) => {
        if (tournaments.length <= 1) return; // Cannot delete last tournament
        
        // Await IndexedDB cleanup
        await deleteTournamentData(id);
        
        setTournaments(prev => {
            const next = prev.filter(t => t.id !== id);
            if (activeTournamentId === id) {
                setActiveTournamentId(next[0].id);
            }
            return next;
        });
    };

    return (
        <TournamentContext.Provider value={{
            tournaments,
            activeTournamentId,
            setActiveTournamentId,
            addTournament,
            renameTournament,
            duplicateTournament,
            deleteTournament,
            isLoaded
        }}>
            {children}
        </TournamentContext.Provider>
    );
}

export const useTournament = () => useContext(TournamentContext);

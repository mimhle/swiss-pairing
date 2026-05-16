"use client";

import { Fragment } from 'react';
import { Tabs } from '@skeletonlabs/skeleton-react';
import { Users, Swords, Table, Settings } from 'lucide-react';
import PlayersTab from '@/features/tournament/PlayersTab';
import RoundsTab from '@/features/tournament/RoundsTab';
import StandingsTab from '@/features/tournament/StandingsTab';
import SettingsTab from '@/features/tournament/SettingsTab';
import { useTournament } from '@/context/TournamentContext';

const tabs = [
    { value: "players", label: "Players", icon: Users },
    { value: "rounds", label: "Rounds", icon: Swords },
    { value: "standings", label: "Standings", icon: Table },
    { value: "settings", label: "Settings", icon: Settings },
];

export default function TournamentTabs() {
    const { activeTab, setActiveTab } = useTournament();

    return (
        <Tabs value={activeTab} onValueChange={(e) => setActiveTab(e.value)}>
            <Tabs.List>
                {tabs.map(({ value, label, icon: Icon }) => (
                    <Fragment key={value}>
                        <Tabs.Trigger 
                            value={value} 
                            className="flex items-center gap-2"
                        >
                            <Icon size={15} />
                            {label}
                        </Tabs.Trigger>
                    </Fragment>
                ))}
                <Tabs.Indicator />
            </Tabs.List>
            <Tabs.Content value="players" className="pt-4">
                {activeTab === 'players' && <PlayersTab />}
            </Tabs.Content>
            <Tabs.Content value="rounds" className="pt-4">
                {activeTab === 'rounds' && <RoundsTab />}
            </Tabs.Content>
            <Tabs.Content value="standings" className="pt-4">
                {activeTab === 'standings' && <StandingsTab />}
            </Tabs.Content>
            <Tabs.Content value="settings" className="pt-4">
                {activeTab === 'settings' && <SettingsTab />}
            </Tabs.Content>
        </Tabs>
    );
}

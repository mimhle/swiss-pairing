"use client";

import { Fragment } from 'react';
import { Tabs } from '@skeletonlabs/skeleton-react';
import { Users, Swords, Settings } from 'lucide-react';
import PlayersTab from '@/app/component/PlayersTab';
import SettingsTab from '@/app/component/SettingsTab';

const tabs = [
    { value: "players", label: "Players", icon: Users },
    { value: "rounds",  label: "Rounds",  icon: Swords },
    { value: "settings", label: "Settings", icon: Settings },
];

export default function TournamentTabs() {
    return (
        <Tabs defaultValue="players">
            <Tabs.List>
                {tabs.map(({ value, label, icon: Icon }) => (
                    <Fragment key={value}>
                        <Tabs.Trigger value={value} className="flex items-center gap-2">
                            <Icon size={15} />
                            {label}
                        </Tabs.Trigger>
                    </Fragment>
                ))}
                <Tabs.Indicator />
            </Tabs.List>
            <Tabs.Content value="players" className="pt-4">
                <PlayersTab />
            </Tabs.Content>
            <Tabs.Content value="rounds" className="pt-4">
                <p className="text-surface-600-400">Rounds go here.</p>
            </Tabs.Content>
            <Tabs.Content value="settings" className="pt-4">
                <SettingsTab />
            </Tabs.Content>
        </Tabs>
    );
}

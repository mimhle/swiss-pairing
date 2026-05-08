"use client";

import { Switch } from '@skeletonlabs/skeleton-react';
import { Sun, Moon } from 'lucide-react';

import { useSyncExternalStore } from 'react';

const MODE_CHANGE_EVENT = 'swiss-mode-change';

const subscribeMode = (callback) => {
    window.addEventListener('storage', callback);
    window.addEventListener(MODE_CHANGE_EVENT, callback);
    return () => {
        window.removeEventListener('storage', callback);
        window.removeEventListener(MODE_CHANGE_EVENT, callback);
    };
};

const getModeSnapshot = () => localStorage.getItem('mode') || 'light';
const getServerModeSnapshot = () => 'light';

export default function Lightswitch() {
    const mode = useSyncExternalStore(subscribeMode, getModeSnapshot, getServerModeSnapshot);
    const checked = mode === 'dark';

    const onCheckedChange = (event) => {
        const nextMode = event.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-mode', nextMode);
        localStorage.setItem('mode', nextMode);
        window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    };

    return (
        <Switch checked={checked} onCheckedChange={onCheckedChange}>
            <Switch.Control>
                <Switch.Thumb>
                    {checked ? <Moon size={14} /> : <Sun size={14} />}
                </Switch.Thumb>
            </Switch.Control>
            <Switch.HiddenInput />
        </Switch>
    );

}

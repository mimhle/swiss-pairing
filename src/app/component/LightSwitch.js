"use client";

import { Switch } from '@skeletonlabs/skeleton-react';
import { Sun, Moon } from 'lucide-react';

import { useEffect, useState } from 'react';

export default function Lightswitch() {
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        const mode = localStorage.getItem('mode') || 'light';
        setChecked(mode === 'dark');
    }, []);

    const onCheckedChange = (event) => {
        const mode = event.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-mode', mode);
        localStorage.setItem('mode', mode);
        setChecked(event.checked);
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
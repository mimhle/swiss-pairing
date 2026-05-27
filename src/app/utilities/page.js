"use client";

import { Fragment, useEffect, useState } from 'react';
import { Tabs } from '@skeletonlabs/skeleton-react';
import { Image as ImageIcon, QrCode, Table } from 'lucide-react';
import ImageConverter from '@/features/utilities/ImageConverter';
import QRCodeGenerator from '@/features/utilities/QRCodeGenerator';
import QuickStandingsCalculator from '@/features/utilities/QuickStandingsCalculator';

const tabs = [
    { value: "quick-standings", label: "Quick Team Standing", icon: Table },
    { value: "image", label: "Image Converter", icon: ImageIcon },
    { value: "qr", label: "QR Code", icon: QrCode },
];
const DEFAULT_TAB = "quick-standings";
const VALID_TABS = new Set(tabs.map(tab => tab.value));

function getTabFromHash() {
    if (typeof window === "undefined") return null;
    const tab = window.location.hash.replace(/^#/, "");
    return VALID_TABS.has(tab) ? tab : null;
}

export default function Utilities() {
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
    const [hasRestoredTabFromHash, setHasRestoredTabFromHash] = useState(false);

    useEffect(() => {
        const handleHashChange = () => {
            const tab = getTabFromHash();
            if (tab) setActiveTab(tab);
        };

        handleHashChange();
        setHasRestoredTabFromHash(true);
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    useEffect(() => {
        if (!hasRestoredTabFromHash) return;
        if (typeof window === "undefined") return;
        if (window.location.hash === `#${activeTab}`) return;

        const url = new URL(window.location.href);
        url.hash = activeTab;
        window.history.replaceState(null, "", url);
    }, [activeTab, hasRestoredTabFromHash]);

    return (
        <main className="max-w-5xl mx-auto px-4 pt-2 py-8">
            <h1 className="h2 py-2 mb-4">Utilities</h1>

            <Tabs value={activeTab} onValueChange={(e) => setActiveTab(e.value)}>
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
                <Tabs.Content value="quick-standings" className="pt-6">
                    <QuickStandingsCalculator />
                </Tabs.Content>
                <Tabs.Content value="image" className="pt-6">
                    <ImageConverter />
                </Tabs.Content>
                <Tabs.Content value="qr" className="pt-6">
                    <QRCodeGenerator />
                </Tabs.Content>
            </Tabs>
        </main>
    );
}

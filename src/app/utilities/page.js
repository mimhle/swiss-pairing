"use client";

import { Fragment } from 'react';
import { Tabs } from '@skeletonlabs/skeleton-react';
import { QrCode, Table } from 'lucide-react';
import QRCodeGenerator from '@/features/utilities/QRCodeGenerator';
import QuickStandingsCalculator from '@/features/utilities/QuickStandingsCalculator';

const tabs = [
    { value: "quick-standings", label: "Quick Team Standing", icon: Table },
    { value: "qr", label: "QR Code", icon: QrCode },
];

export default function Utilities() {
    return (
        <main className="max-w-5xl mx-auto px-4 pt-2 py-8">
            <h1 className="h2 py-2 mb-4">Utilities</h1>

            <Tabs defaultValue="quick-standings">
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
                <Tabs.Content value="qr" className="pt-6">
                    <QRCodeGenerator />
                </Tabs.Content>
                <Tabs.Content value="quick-standings" className="pt-6">
                    <QuickStandingsCalculator />
                </Tabs.Content>
            </Tabs>
        </main>
    );
}

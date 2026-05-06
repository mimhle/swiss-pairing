"use client";

import { Fragment } from 'react';
import { Tabs } from '@skeletonlabs/skeleton-react';
import { QrCode, Tooltip } from 'lucide-react';
import QRCodeGenerator from '@/app/component/QRCodeGenerator';

const tabs = [
    { value: "qr", label: "QR Code", icon: QrCode },
];

export default function Utilities() {
    return (
        <main className="max-w-5xl mx-auto px-4 pt-2 py-8">
            <h1 className="h2 py-2 mb-4">Utilities</h1>

            <Tabs defaultValue="qr">
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
            </Tabs>
        </main>
    );
}

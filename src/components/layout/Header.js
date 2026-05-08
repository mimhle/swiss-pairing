"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Lightswitch from "@/components/layout/LightSwitch";

const links = [
    { href: "/", label: "Tournament" },
    // { href: "/standings", label: "Standings" },
    { href: "/utilities", label: "Utilities" }
];

export default function Header() {
    const pathname = usePathname();

    return (
        <header className="sticky top-0 z-10 bg-surface-100-900 border-b border-surface-200-800">
            <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-8">
                <span className="font-bold text-lg hidden sm:block">Swiss Pairing</span>

                <nav className="flex gap-1 flex-1 justify-end sm:justify-start">
                    {links.map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`px-3 py-1.5 rounded text-sm font-medium ${pathname === href
                                ? "preset-filled"
                                : "hover:preset-tonal"
                                }`}
                        >
                            {label}
                        </Link>
                    ))}
                </nav>
                <Lightswitch />
            </div>
        </header>
    );
}

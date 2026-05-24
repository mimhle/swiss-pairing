import "./globals.css";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { TournamentProvider } from "@/context/TournamentContext";
import { DriveSyncProvider } from "@/context/DriveSyncContext";

export default function RootLayout({ children }) {
    return (
        <html
            lang="en"
            className="antialiased"
            data-theme="cerberus"
            suppressHydrationWarning
        >
        <head>
            <script dangerouslySetInnerHTML={{ __html: `
                const mode = localStorage.getItem('mode') || 'light';
                document.documentElement.setAttribute('data-mode', mode);
            ` }} />
        </head>
        <body className="min-h-screen flex flex-col bg-surface-50-950 text-surface-950-50">
            <TournamentProvider>
                <DriveSyncProvider>
                    <Header />
                    <main className="flex-1">{children}</main>
                    <Footer />
                </DriveSyncProvider>
            </TournamentProvider>
        </body>
        </html>
    );
}

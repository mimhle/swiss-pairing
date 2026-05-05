import "./globals.css";
import Header from "@/app/component/Header";
import Footer from "@/app/component/Footer";
import { TournamentProvider } from "@/app/context/TournamentContext";

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
        <body className="min-h-screen flex flex-col">
            <TournamentProvider>
                <Header />
                <main className="flex-1">{children}</main>
                <Footer />
            </TournamentProvider>
        </body>
        </html>
    );
}

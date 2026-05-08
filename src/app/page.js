import TournamentTabs from "@/features/tournament/TournamentTabs";
import TournamentSelector from "@/features/tournament/TournamentSelector";

export default function Home() {
    return (
        <main className="max-w-5xl mx-auto px-4 pt-2 py-8">
            <TournamentSelector />
            <TournamentTabs />
        </main>
    );
}

import TournamentTabs from "@/app/component/TournamentTabs";
import TournamentSelector from "@/app/component/TournamentSelector";

export default function Home() {
    return (
        <main className="max-w-5xl mx-auto px-4 pt-2 py-8">
            <TournamentSelector />
            <TournamentTabs />
        </main>
    );
}

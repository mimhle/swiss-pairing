import ScoreboardClient from '@/features/scoreboard/ScoreboardClient';

export const metadata = {
    title: 'Live Scoreboard',
    description: 'Read-only live tournament scoreboard.',
    robots: {
        index: false,
        follow: false,
    },
};

export default async function ScoreboardPage({ params }) {
    const { id } = await params;
    return <ScoreboardClient sessionId={id} />;
}

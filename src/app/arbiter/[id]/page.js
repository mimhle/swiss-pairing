import ArbiterClient from './ArbiterClient';

export const metadata = {
  title: 'Remote Score Input',
  description: 'Remote score input for arbiters',
};

export default async function ArbiterPage({ params }) {
  const { id } = await params;
  return <ArbiterClient sessionId={id} />;
}

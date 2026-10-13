import { VoterApp } from './VoterApp';

export const metadata = { title: 'Cast your vote', robots: { index: false } };

export default function Vote() {
  return <VoterApp />;
}

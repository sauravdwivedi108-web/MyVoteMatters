import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MyVoteMatters',
    short_name: 'MyVote',
    description: 'Secure corporate e-voting',
    start_url: '/app',
    display: 'standalone',
    background_color: '#f3efe6',
    theme_color: '#0e1c2f',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

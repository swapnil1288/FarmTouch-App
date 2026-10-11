import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Farm’s Touch — Fresh vegetables & fruits in Pune',
  description: 'Farm-fresh vegetables, fruits and custom weekly baskets delivered across Pune. Order online or on WhatsApp.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
  other: { 'codex-preview': 'development' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B7A3E',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout applies to every page */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

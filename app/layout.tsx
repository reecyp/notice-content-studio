import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Notice Content Studio',
  description: 'Render and export Notice paper-note slideshow decks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

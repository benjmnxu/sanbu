import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sanbu',
  description: 'Fastest vs best walking routes with POI-aware detours'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

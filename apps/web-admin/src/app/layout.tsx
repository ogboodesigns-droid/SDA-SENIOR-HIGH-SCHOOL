import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SDA SHS Admin',
  description: 'S.D.A Senior High School, Asokore-Koforidua — administration portal',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body>{children}</body>
    </html>
  );
}

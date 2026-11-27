import type { Metadata } from 'next';
import { Poppins, Noto_Sans_Devanagari } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

const poppins = Poppins({ subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-poppins', display: 'swap' });
const deva = Noto_Sans_Devanagari({ subsets: ['devanagari'], weight: ['500', '600', '700'], variable: '--font-deva', display: 'swap' });

export const metadata: Metadata = {
  title: 'कार्यसेतु — Shah Engineers',
  description: 'कार्यसेतु (KaryaSetu): field service management for Shah Engineers & Consultants',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${deva.variable}`}>
      <body className="bg-surface font-sans text-slate-900 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

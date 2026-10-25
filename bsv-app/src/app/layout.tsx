import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'BSV Weitnau | Dienstplanung', description: 'Interne Dienstplanung des BSV Weitnau' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'SiteForge | Test Websites', description: 'Controlled fictional websites and private answer keys for migration testing.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

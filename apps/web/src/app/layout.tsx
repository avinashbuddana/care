import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '../components/layout/providers';
import './globals.css';
export const metadata: Metadata = {
  title: 'Powerbridge · Migration workspace',
  description: 'Schema review, verified CSV imports, and governed reporting.',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

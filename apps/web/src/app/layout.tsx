import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'CRM Copilot', template: '%s · CRM Copilot' },
  description:
    'A CRM with an AI copilot: tool calling, smart actions and natural-language filters.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}

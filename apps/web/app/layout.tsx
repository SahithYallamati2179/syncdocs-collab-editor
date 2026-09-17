import type { Metadata } from 'next'
import { THEME_BOOTSTRAP } from '@/lib/theme'
import './globals.css'

export const metadata: Metadata = {
  title: 'SyncDocs',
  description:
    'A real-time collaborative rich-text editor built on Yjs CRDTs, with live presence, offline editing and instrumented telemetry.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Loaded as a stylesheet link rather than through next/font so the build
          does not depend on reaching Google's servers. If the request fails the
          stack falls back to system-ui, which the tokens already declare.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
        {/* Applies the saved theme before first paint so dark mode never flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Ad Creative Generator',
  description:
    'Generate platform-perfect ad copy and visuals. Arena Ad Creative for Instagram — professional tone, ready to export.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100`}>
        {children}
      </body>
    </html>
  )
}

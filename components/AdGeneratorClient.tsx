"use client"

import { useState } from 'react'
import Header from '@/components/Header'
import AdCard from '@/components/AdCard'
import WhyItWorks from '@/components/WhyItWorks'
import type { AdCreative } from '@/lib/types'

interface AdGeneratorClientProps {
  creative: AdCreative
}

export default function AdGeneratorClient({ creative }: AdGeneratorClientProps) {
  const [darkMode, setDarkMode] = useState(false)

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    if (next) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  return (
    <div className="min-h-screen">
      <Header darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />

      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10 sm:px-6">
        <div className="mb-8 text-center">
          <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
            Generated creative · {creative.tone} tone
          </p>
          <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Your ad for <span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">{creative.product}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600 dark:text-slate-400 sm:text-base">
            Platform-perfect copy and visuals, styled for {creative.platform}. Review the creative below and export it as a PNG.
          </p>
        </div>

        <AdCard creative={creative} />

        <WhyItWorks points={creative.whyItWorks} />
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Built with Ad Creative Generator · {creative.product} · {creative.platform}
      </footer>
    </div>
  )
}

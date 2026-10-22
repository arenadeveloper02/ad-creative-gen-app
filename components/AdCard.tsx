"use client"

import { useRef, useState } from 'react'
import { Download, Check, Loader2, Heart, MessageCircle, Send, Bookmark, Sparkles } from 'lucide-react'
import PlatformBadge from '@/components/PlatformBadge'
import { logExport } from '@/lib/actions'
import type { AdCreative } from '@/lib/types'

interface AdCardProps {
  creative: AdCreative
}

export default function AdCard({ creative }: AdCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)

  const handleExport = async () => {
    const node = cardRef.current
    if (!node || exporting) return
    setExporting(true)
    setExported(false)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
      })
      const dataUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'arena-ad-creative-instagram.png'
      link.click()
      setExported(true)
      await logExport(creative.platform, creative.product)
      setTimeout(() => setExported(false), 2500)
    } catch {
      setExported(false)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section aria-label="Generated ad creative">
      <div
        ref={cardRef}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Card header — account row */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-xs font-bold text-white">
              AA
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">{creative.product}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Sponsored</p>
            </div>
          </div>
          <PlatformBadge platform={creative.platform} />
        </div>

        {/* Generated ad image — full width, 1:1 */}
        <div
          role="img"
          aria-label={creative.imageAlt}
          className="relative flex aspect-square w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-600 px-8 text-center"
        >
          <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-12 h-64 w-64 rounded-full bg-fuchsia-300/20 blur-3xl" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />

          <span className="relative mb-5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI-Generated Creative
          </span>
          <p className="relative text-balance text-3xl font-extrabold leading-tight text-white drop-shadow-sm sm:text-4xl">
            {creative.headline}
          </p>
          <p className="relative mt-4 text-sm font-medium text-indigo-100">
            {creative.product} · {creative.platform} · {creative.tone}
          </p>
          <span className="relative mt-7 rounded-full bg-white px-6 py-2.5 text-sm font-bold text-indigo-700 shadow-lg">
            {creative.cta}
          </span>
        </div>

        {/* Instagram-style action row */}
        <div className="flex items-center justify-between px-4 pt-3 text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-4">
            <Heart className="h-5 w-5" aria-hidden="true" />
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
            <Send className="h-5 w-5" aria-hidden="true" />
          </div>
          <Bookmark className="h-5 w-5" aria-hidden="true" />
        </div>

        {/* Copy block */}
        <div className="px-4 pb-5 pt-3">
          <h2 className="text-balance text-lg font-bold leading-snug">{creative.headline}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{creative.body}</p>
          <p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {creative.hashtags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-5 py-3 text-sm font-bold text-white shadow-card transition hover:from-indigo-700 hover:to-fuchsia-700"
          >
            {creative.cta}
          </button>
        </div>
      </div>

      {/* Export control (outside captured card) */}
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : exported ? (
            <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {exporting ? 'Exporting…' : exported ? 'Exported!' : 'Export as PNG'}
        </button>
      </div>
    </section>
  )
}

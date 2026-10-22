import { CheckCircle2 } from 'lucide-react'
import type { WhyItWorksPoint } from '@/lib/types'

interface WhyItWorksProps {
  points: WhyItWorksPoint[]
}

export default function WhyItWorks({ points }: WhyItWorksProps) {
  return (
    <section aria-label="Why it works" className="mt-12">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Why it works</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          The strategy behind this creative, broken down.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {points.map((point) => (
          <div
            key={point.title}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-card dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-bold">{point.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {point.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

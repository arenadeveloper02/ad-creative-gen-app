import { Instagram, Linkedin, Globe } from 'lucide-react'

interface PlatformBadgeProps {
  platform: string
}

export default function PlatformBadge({ platform }: PlatformBadgeProps) {
  const normalized = platform.toLowerCase()

  const icon =
    normalized === 'instagram' ? (
      <Instagram className="h-3.5 w-3.5" aria-hidden="true" />
    ) : normalized === 'linkedin' ? (
      <Linkedin className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
    )

  const classes =
    normalized === 'instagram'
      ? 'bg-gradient-to-r from-fuchsia-600 via-pink-600 to-orange-500 text-white'
      : normalized === 'linkedin'
        ? 'bg-sky-700 text-white'
        : 'bg-slate-700 text-white'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${classes}`}>
      {icon}
      {platform}
    </span>
  )
}

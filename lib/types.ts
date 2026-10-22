export interface WhyItWorksPoint {
  title: string
  description: string
}

export interface AdCreative {
  product: string
  platform: string
  tone: string
  cta: string
  headline: string
  body: string
  hashtags: string[]
  imageAlt: string
  whyItWorks: WhyItWorksPoint[]
}

export type ExportResult = { success: boolean; error?: string }

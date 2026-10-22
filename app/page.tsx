import AdGeneratorClient from '@/components/AdGeneratorClient'
import { adCreative } from '@/lib/adData'

export default function HomePage() {
  return <AdGeneratorClient creative={adCreative} />
}

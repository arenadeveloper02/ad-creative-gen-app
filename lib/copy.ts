import { LAYOUTS, BACKGROUNDS, sizeForFormat, type Background, type Layout } from '@/lib/platforms';

export interface CopyInput {
  product: string;
  brand: string;
  goal: string;
  tone: string;
  audience: string;
  description: string;
  cta: string;
  copySource: 'ai' | 'manual';
  headline: string;
  subline: string;
}

export interface VersionDraft {
  headline: string;
  sub: string;
  primary: string;
  cta: string;
  layout: Layout;
  bg: Background;
  size: string;
}

const HEADS: Array<(product: string, goal: string) => string> = [
  (product) => `${product} — built for results`,
  (product) => `Make ${product} work harder`,
  (_product, goal) => `${goal} starts here`,
  (product) => `Meet ${product}`,
  (_product, goal) => `The smarter way to ${goal.toLowerCase()}`,
];

const SUBS: Array<string | ((tone: string) => string)> = [
  'Trusted by teams that move fast.',
  (tone: string) => `${tone} by design. Proven in practice.`,
  'Set up in minutes, not months.',
  'See the difference in week one.',
];

/** Server-side copy. The index picks a different line for each version. */
export function draftVersion(input: CopyInput, index: number, format: string): VersionDraft {
  const product = input.product || input.brand || 'your product';
  const goal = input.goal || 'Awareness';
  const tone = input.tone || 'Professional';
  const headFn = HEADS[index % HEADS.length];
  const subEntry = SUBS[index % SUBS.length];
  const ai = input.copySource !== 'manual';
  const headline = (!ai && input.headline) || headFn(product, goal);
  const sub = (!ai && input.subline) || (typeof subEntry === 'string' ? subEntry : subEntry(tone));
  const base = input.description || `${product} helps ${input.audience || 'your audience'} get more done.`;
  const primary = `${base} ${input.cta || 'Get started'} today.`.slice(0, 4000);
  return {
    headline: headline.slice(0, 200),
    sub: sub.slice(0, 200),
    primary,
    cta: input.cta || 'Get started',
    layout: LAYOUTS[index % LAYOUTS.length],
    bg: BACKGROUNDS[index % BACKGROUNDS.length],
    size: sizeForFormat(format),
  };
}

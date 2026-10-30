import type { Layout } from '@/lib/platforms';

export interface ImagePromptInput {
  description: string;
  sceneNote: string;
  goal: string;
  brandName: string;
  product: string;
  platform: string;
  format: string;
  audience: string;
  tone: string;
  visualStyle: string;
  avoid: string;
  c1: string;
  c2: string;
  c3: string;
  layout: Layout;
  hasLogo: boolean;
  hasReferences: boolean;
  variant: number;
}

const STYLE_NOTES: Record<string, string> = {
  'Clean / minimal': 'clean minimal composition, generous negative space, soft studio light, one clear subject',
  'Product shot': 'hero product photograph, sharp focus on the product, premium studio lighting, subtle reflections',
  'Lifestyle photo': 'candid lifestyle photograph of real people using the product, natural light, authentic setting',
  'Gradient / abstract': 'abstract gradient backdrop with smooth flowing shapes, depth and glow, no people',
  Illustration: 'flat vector illustration, bold simple shapes, consistent line weight, friendly characters',
  'Bold typography': 'graphic poster composition with strong geometric blocks and high contrast, space reserved for large type',
};

const TONE_NOTES: Record<string, string> = {
  Professional: 'confident, polished, corporate-friendly mood',
  Bold: 'high-energy, dramatic contrast, striking angles',
  Friendly: 'warm, approachable, smiling, soft colours',
  Playful: 'fun, bright, dynamic, a touch of humour',
  Premium: 'luxurious, refined, dark tones with metallic accents',
  Urgent: 'punchy, time-sensitive feel, strong focal point',
};

const LAYOUT_NOTES: Record<Layout, string> = {
  left: 'keep the left 45% of the frame visually quiet so a headline can sit there',
  center: 'keep the centre of the frame open for a headline; subject framed around the edges',
  bottom: 'keep the bottom third of the frame simple and darker so a text band can sit there',
};

const VARIANT_NOTES = [
  'close framing, eye-level camera',
  'wider environmental framing, slight low angle',
  'overhead or three-quarter view with a different setting',
  'dramatic side light and a tighter crop',
];

/** The brief, platform, brand and layout turned into one precise image prompt. */
export function buildImagePrompt(input: ImagePromptInput): string {
  const product = input.product || input.brandName || 'the product';
  const lines: string[] = [];
  lines.push(`Professional B2B advertising photograph for ${product}${input.brandName ? ` by ${input.brandName}` : ''}. Credible, polished, and made for a business buyer.`);
  if (input.description) lines.push(`What the user wants: ${input.description}. Follow this for the offer and for the picture: people, setting, background, and lighting.`);
  if (input.sceneNote) lines.push(`Scene the user asked for: ${input.sceneNote}. This controls the setting, background, and lighting.`);
  lines.push(`Campaign goal: ${input.goal}. Platform: ${input.platform}, ${input.format} placement.`);
  if (input.audience) lines.push(`Audience: ${input.audience}. Show working professionals, not a consumer lifestyle.`);
  lines.push(`Visual style: ${STYLE_NOTES[input.visualStyle] ?? input.visualStyle}.`);
  lines.push(`Mood: ${TONE_NOTES[input.tone] ?? input.tone}.`);
  lines.push(`Brand colours ${input.c1}, ${input.c2}, and ${input.c3} are the professional palette. Keep them. If they read as blue, use a corporate navy or blue. If they read as red, use a strong brand red. Put that colour on the product interface, logo area, clothing accents, and graphic shapes so the ad looks like a finished B2B campaign. Do not flatten the whole room into one tint.`);
  lines.push(`Composition: ${LAYOUT_NOTES[input.layout]}. ${VARIANT_NOTES[input.variant % VARIANT_NOTES.length]}.`);
  if (input.variant >= 2) {
    lines.push('This is another version in the same campaign as Version A and B. Keep the same format, aspect ratio, production quality, lighting family, scene world, and brand colour treatment. Change only the camera angle and framing so it still looks like the same ad set.');
  }
  if (input.hasReferences) lines.push('Match the look, palette and art direction of the attached reference creatives.');
  if (input.hasLogo) lines.push('The attached logo is the brand mark; place it small and legible, never distorted.');
  lines.push('Photorealistic, high detail, commercial quality, correct anatomy and product proportions.');
  lines.push('Do not render any words, letters, captions, watermarks or UI; text is added separately.');
  if (input.avoid) lines.push(`Avoid: ${input.avoid}.`);
  return lines.join('\n').slice(0, 4000);
}

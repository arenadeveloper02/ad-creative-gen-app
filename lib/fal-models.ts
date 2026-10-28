import { isRecord } from '@/lib/json';

// Text copy goes through fal.ai as well, so the existing FAL_KEY is enough.
export const LLM_ENDPOINT = 'fal-ai/any-llm';

export function llmModel(): string {
  const value = process.env.FAL_LLM_MODEL;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'google/gemini-2.5-flash';
}

export function buildLlmInput(systemPrompt: string, prompt: string): Record<string, unknown> {
  return { model: llmModel(), system_prompt: systemPrompt, prompt };
}

// ---------------------------------------------------------------------------
// Every image choice maps to one fal.ai endpoint here. Same ids as the video
// agent so the same models and the same per-image pricing apply.
// ---------------------------------------------------------------------------

export const IMAGE_MODELS = [
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', hint: 'Highest quality · 4K PNG' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', hint: 'Best prompt accuracy · ~$0.05 / image' },
  { value: 'nano-banana', label: 'Nano Banana', hint: 'Fast · ~$0.05 / image' },
  { value: 'gpt-image-1', label: 'GPT Image 1', hint: 'Strong text in image · ~$0.05 / image' },
  { value: 'flux-1.1-pro', label: 'FLUX 1.1 Pro', hint: 'Photoreal · ~$0.05 / image' },
] as const;

export type ImageModel = (typeof IMAGE_MODELS)[number]['value'];
export const DEFAULT_IMAGE_MODEL: ImageModel = 'nano-banana-pro';

export function isImageModel(value: unknown): value is ImageModel {
  return typeof value === 'string' && IMAGE_MODELS.some((model) => model.value === value);
}

export function canonicalImageModel(value: unknown): ImageModel {
  return isImageModel(value) ? value : DEFAULT_IMAGE_MODEL;
}

const NANO_RATIOS = new Set(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']);

/** Pixel size such as 1080x1350 to the closest ratio the model accepts. */
export function ratioForSize(size: string): string {
  const [w, h] = size.split('x').map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '1:1';
  const r = w / h;
  const table: Array<[string, number]> = [
    ['21:9', 21 / 9], ['16:9', 16 / 9], ['3:2', 1.5], ['4:3', 4 / 3], ['5:4', 1.25], ['1:1', 1],
    ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['9:16', 9 / 16],
  ];
  let best = table[0];
  for (const entry of table) if (Math.abs(entry[1] - r) < Math.abs(best[1] - r)) best = entry;
  return best[0];
}

function toolkitImageSize(ratio: string): string | { width: number; height: number } {
  switch (ratio) {
    case '16:9':
    case '21:9':
      return 'landscape_16_9';
    case '9:16':
    case '2:3':
      return 'portrait_16_9';
    case '4:3':
    case '3:2':
    case '5:4':
      return 'landscape_4_3';
    case '3:4':
    case '4:5':
      return 'portrait_4_3';
    default:
      return 'square_hd';
  }
}

function gptImageSize(ratio: string): string {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '4:5' || ratio === '2:3') return 'portrait_4_3';
  if (ratio === '1:1') return 'square_hd';
  return 'landscape_4_3';
}

export interface ImageJobSpec {
  endpoint: string;
  input: Record<string, unknown>;
}

/** Text-to-image, or the edit endpoint when reference images are present. */
export function buildImageJob(opts: { prompt: string; size: string; model: ImageModel; referenceImageUrls: string[] }): ImageJobSpec {
  const ratio = ratioForSize(opts.size);
  const refs = opts.referenceImageUrls.filter((u) => /^https:\/\//i.test(u)).slice(0, 6);
  const nano = NANO_RATIOS.has(ratio) ? ratio : '1:1';
  switch (opts.model) {
    case 'nano-banana-pro': {
      const quality = { resolution: '4K', num_images: 1, output_format: 'png', thinking_level: 'high' };
      if (refs.length > 0) {
        return { endpoint: 'fal-ai/nano-banana-pro/edit', input: { prompt: opts.prompt, image_urls: refs, aspect_ratio: nano, ...quality } };
      }
      return { endpoint: 'fal-ai/nano-banana-pro', input: { prompt: opts.prompt, aspect_ratio: nano, ...quality } };
    }
    case 'nano-banana-2': {
      const quality = { resolution: '4K', num_images: 1, output_format: 'png', thinking_level: 'high' };
      if (refs.length > 0) {
        return { endpoint: 'fal-ai/nano-banana-2/edit', input: { prompt: opts.prompt, image_urls: refs, aspect_ratio: nano, ...quality } };
      }
      return { endpoint: 'fal-ai/nano-banana-2', input: { prompt: opts.prompt, aspect_ratio: nano, ...quality } };
    }
    case 'nano-banana':
      if (refs.length > 0) {
        return { endpoint: 'fal-ai/nano-banana/edit', input: { prompt: opts.prompt, image_urls: refs, num_images: 1, output_format: 'png' } };
      }
      return { endpoint: 'fal-ai/nano-banana', input: { prompt: opts.prompt, aspect_ratio: nano, num_images: 1, output_format: 'png' } };
    case 'gpt-image-1':
      if (refs.length > 0) {
        return { endpoint: 'fal-ai/gpt-image-1/edit-image', input: { prompt: opts.prompt, image_urls: refs, image_size: gptImageSize(ratio), quality: 'medium', num_images: 1 } };
      }
      return { endpoint: 'fal-ai/gpt-image-1/text-to-image', input: { prompt: opts.prompt, image_size: gptImageSize(ratio), quality: 'medium', num_images: 1 } };
    case 'flux-1.1-pro':
      return { endpoint: 'fal-ai/flux-pro/v1.1', input: { prompt: opts.prompt, image_size: toolkitImageSize(ratio), num_images: 1, output_format: 'jpeg', safety_tolerance: '2' } };
  }
}

export function readImageUrl(output: unknown): string | null {
  if (!isRecord(output)) return null;
  const images = output.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      const url = isRecord(img) && typeof img.url === 'string' ? img.url : typeof img === 'string' ? img : null;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  }
  if (isRecord(output.image) && typeof output.image.url === 'string') return output.image.url;
  return null;
}

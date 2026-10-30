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
// Image models on fal.ai. Nano Banana Pro at 4K is the default.
// Every OpenAI GPT Image model currently listed on fal is included below.
// ---------------------------------------------------------------------------

export const IMAGE_MODELS = [
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', hint: 'Highest quality · Google Gemini 3 Pro Image · 1K / 2K / 4K' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', hint: 'Fast high quality · Google Gemini Flash Image · 1K / 2K / 4K' },
  { value: 'nano-banana', label: 'Nano Banana', hint: 'Fast · fixed output size' },
  { value: 'gpt-image-1', label: 'GPT Image 1 (OpenAI)', hint: 'OpenAI on fal · strong text in the picture' },
  { value: 'gpt-image-1.5', label: 'GPT Image 1.5 (OpenAI)', hint: 'OpenAI on fal · higher fidelity than GPT Image 1' },
  { value: 'gpt-image-2', label: 'GPT Image 2 (OpenAI)', hint: 'OpenAI on fal · dense typography · up to 4K' },
  { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (OpenAI)', hint: 'OpenAI on fal · fast default GPT Image 2.5' },
  { value: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst (OpenAI)', hint: 'OpenAI on fal · slower · more detail' },
  { value: 'flux-1.1-pro', label: 'FLUX 1.1 Pro', hint: 'Photoreal · fal FLUX Pro' },
] as const;

export type ImageModel = (typeof IMAGE_MODELS)[number]['value'];
export const DEFAULT_IMAGE_MODEL: ImageModel = 'nano-banana-pro';

export const IMAGE_RESOLUTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const;

export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number]['value'];
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = '4K';

export function isImageModel(value: unknown): value is ImageModel {
  return typeof value === 'string' && IMAGE_MODELS.some((model) => model.value === value);
}

export function canonicalImageModel(value: unknown): ImageModel {
  return isImageModel(value) ? value : DEFAULT_IMAGE_MODEL;
}

export function isImageResolution(value: unknown): value is ImageResolution {
  return typeof value === 'string' && IMAGE_RESOLUTIONS.some((item) => item.value === value);
}

export function canonicalImageResolution(value: unknown): ImageResolution {
  return isImageResolution(value) ? value : DEFAULT_IMAGE_RESOLUTION;
}

/** Which resolution choices this model actually accepts on fal. */
export function resolutionsForModel(model: ImageModel): readonly ImageResolution[] {
  if (model === 'nano-banana-pro' || model === 'nano-banana-2') return ['1K', '2K', '4K'];
  if (
    model === 'gpt-image-1'
    || model === 'gpt-image-1.5'
    || model === 'gpt-image-2'
    || model === 'gpt-image-2.5-flare'
    || model === 'gpt-image-2.5-sunburst'
  ) {
    return ['1K', '2K', '4K'];
  }
  return ['1K'];
}

export function modelLabel(model: ImageModel): string {
  return IMAGE_MODELS.find((item) => item.value === model)?.label ?? model;
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

/** GPT Image 1 / 1.5 fixed enums on fal. */
function gptFixedSize(ratio: string): string {
  if (ratio === '9:16' || ratio === '3:4' || ratio === '4:5' || ratio === '2:3') return '1024x1536';
  if (ratio === '1:1') return '1024x1024';
  return '1536x1024';
}

function gptQuality(resolution: ImageResolution): 'low' | 'medium' | 'high' {
  if (resolution === '4K') return 'high';
  if (resolution === '2K') return 'medium';
  return 'low';
}

/** GPT Image 2 / 2.5: presets for 1K, custom edges for 2K and 4K (max edge 3840). */
function gptModernSize(ratio: string, resolution: ImageResolution): string | { width: number; height: number } {
  if (resolution === '1K') return toolkitImageSize(ratio);
  const long = resolution === '4K' ? 3840 : 2560;
  const short = Math.round(long * (
    ratio === '1:1' ? 1
      : ratio === '16:9' || ratio === '21:9' ? 9 / 16
        : ratio === '9:16' || ratio === '2:3' ? 16 / 9
          : ratio === '4:3' || ratio === '3:2' || ratio === '5:4' ? 3 / 4
            : ratio === '3:4' || ratio === '4:5' ? 4 / 3
              : 1
  ));
  const even = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  if (ratio === '1:1') return { width: even(long), height: even(long) };
  if (ratio === '9:16' || ratio === '2:3' || ratio === '3:4' || ratio === '4:5') {
    return { width: even(short), height: even(long) };
  }
  return { width: even(long), height: even(short) };
}

function gptModernQuality(resolution: ImageResolution, advanced: boolean): string {
  if (advanced) {
    if (resolution === '4K') return 'xhigh';
    if (resolution === '2K') return 'high';
    return 'medium';
  }
  return gptQuality(resolution);
}

export interface ImageJobSpec {
  endpoint: string;
  input: Record<string, unknown>;
}

function gptLegacyJob(opts: {
  prompt: string;
  size: string;
  resolution: ImageResolution;
  refs: string[];
  textEndpoint: string;
  editEndpoint: string;
}): ImageJobSpec {
  const ratio = ratioForSize(opts.size);
  const input = {
    prompt: opts.prompt,
    image_size: gptFixedSize(ratio),
    quality: gptQuality(opts.resolution),
    num_images: 1,
    output_format: 'png',
  };
  if (opts.refs.length > 0) {
    return { endpoint: opts.editEndpoint, input: { ...input, image_urls: opts.refs } };
  }
  return { endpoint: opts.textEndpoint, input };
}

function gptModernJob(opts: {
  prompt: string;
  size: string;
  resolution: ImageResolution;
  refs: string[];
  textEndpoint: string;
  editEndpoint: string;
  advancedQuality: boolean;
}): ImageJobSpec {
  const ratio = ratioForSize(opts.size);
  const input = {
    prompt: opts.prompt,
    image_size: gptModernSize(ratio, opts.resolution),
    quality: gptModernQuality(opts.resolution, opts.advancedQuality),
    num_images: 1,
    output_format: 'png',
  };
  if (opts.refs.length > 0) {
    return { endpoint: opts.editEndpoint, input: { ...input, image_urls: opts.refs } };
  }
  return { endpoint: opts.textEndpoint, input };
}

/** Text-to-image, or the edit endpoint when reference images are present. */
export function buildImageJob(opts: {
  prompt: string;
  size: string;
  model: ImageModel;
  resolution?: ImageResolution;
  referenceImageUrls: string[];
}): ImageJobSpec {
  const ratio = ratioForSize(opts.size);
  const refs = opts.referenceImageUrls.filter((u) => /^https:\/\//i.test(u)).slice(0, 6);
  const nano = NANO_RATIOS.has(ratio) ? ratio : '1:1';
  const allowed = resolutionsForModel(opts.model);
  const resolution = allowed.includes(opts.resolution as ImageResolution)
    ? (opts.resolution as ImageResolution)
    : (allowed[allowed.length - 1] ?? DEFAULT_IMAGE_RESOLUTION);

  switch (opts.model) {
    case 'nano-banana-pro': {
      const quality = { resolution, num_images: 1, output_format: 'png', thinking_level: 'high' };
      if (refs.length > 0) {
        return { endpoint: 'fal-ai/nano-banana-pro/edit', input: { prompt: opts.prompt, image_urls: refs, aspect_ratio: nano, ...quality } };
      }
      return { endpoint: 'fal-ai/nano-banana-pro', input: { prompt: opts.prompt, aspect_ratio: nano, ...quality } };
    }
    case 'nano-banana-2': {
      const quality = { resolution, num_images: 1, output_format: 'png', thinking_level: 'high' };
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
      return gptLegacyJob({
        prompt: opts.prompt,
        size: opts.size,
        resolution,
        refs,
        textEndpoint: 'fal-ai/gpt-image-1/text-to-image',
        editEndpoint: 'fal-ai/gpt-image-1/edit-image',
      });
    case 'gpt-image-1.5':
      return gptLegacyJob({
        prompt: opts.prompt,
        size: opts.size,
        resolution,
        refs,
        textEndpoint: 'fal-ai/gpt-image-1.5',
        editEndpoint: 'fal-ai/gpt-image-1.5/edit',
      });
    case 'gpt-image-2':
      return gptModernJob({
        prompt: opts.prompt,
        size: opts.size,
        resolution,
        refs,
        textEndpoint: 'openai/gpt-image-2',
        editEndpoint: 'openai/gpt-image-2/edit',
        advancedQuality: false,
      });
    case 'gpt-image-2.5-flare':
      return gptModernJob({
        prompt: opts.prompt,
        size: opts.size,
        resolution,
        refs,
        textEndpoint: 'openai/gpt-image-2.5/flare/text-to-image',
        editEndpoint: 'openai/gpt-image-2.5/flare/edit',
        advancedQuality: true,
      });
    case 'gpt-image-2.5-sunburst':
      return gptModernJob({
        prompt: opts.prompt,
        size: opts.size,
        resolution,
        refs,
        textEndpoint: 'openai/gpt-image-2.5/sunburst/text-to-image',
        editEndpoint: 'openai/gpt-image-2.5/sunburst/edit',
        advancedQuality: true,
      });
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

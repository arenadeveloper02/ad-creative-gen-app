import { ASSET_KINDS, BACKGROUNDS, COPY_SOURCES, GOALS, LAYOUTS, PLATFORMS, SIZES, TONES, VISUAL_STYLES, type AssetKind, type Background, type CopySource, type Layout } from '@/lib/platforms';
import { MAX_NAME, MAX_SHORT, MAX_TEXT, MAX_URL } from '@/lib/limits';
import { canonicalImageModel, type ImageModel } from '@/lib/fal-models';

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const ID_RE = /^[a-z0-9]{8,40}$/i;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function parseEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || email.includes('\n') || email.includes('\r')) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

export function cleanHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.trim();
  return HEX_RE.test(hex) ? hex.toUpperCase() : fallback;
}

export function cleanHttpUrl(value: unknown): string | null {
  const raw = cleanText(value, MAX_URL);
  if (raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return url.toString();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function cleanFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '').slice(0, 180);
  return cleaned === '' ? 'file' : cleaned;
}

export function svgIsUnsafe(bytes: Buffer): boolean {
  const text = bytes.toString('utf8').toLowerCase();
  return /<script|onload=|onerror=|javascript:|foreignobject|<iframe/.test(text);
}

export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === 'string' && (ASSET_KINDS as readonly string[]).includes(value);
}

export interface BriefInput {
  description: string;
  goal: string;
  brandName: string;
  product: string;
  guidelineUrl: string | null;
  profileId: string | null;
  c1: string;
  c2: string;
  c3: string;
  assetIds: string[];
}

export function parseBrief(body: Record<string, unknown>): BriefInput | { error: string } {
  const description = cleanText(body.description, MAX_TEXT);
  const goal = oneOf(body.goal, GOALS, 'Awareness');
  const brandName = cleanText(body.brandName, MAX_NAME);
  const product = cleanText(body.product, MAX_NAME);
  const guidelineUrl = body.guidelineUrl === undefined || body.guidelineUrl === '' ? null : cleanHttpUrl(body.guidelineUrl);
  if (body.guidelineUrl && body.guidelineUrl !== '' && guidelineUrl === null) {
    return { error: 'Guidelines link must be an http or https URL.' };
  }
  const profileId = body.profileId === null || body.profileId === '' || body.profileId === undefined ? null : body.profileId;
  if (profileId !== null && !isId(profileId)) return { error: 'Invalid brand profile.' };
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds.filter(isId).slice(0, 20) : [];
  return {
    description,
    goal,
    brandName,
    product,
    guidelineUrl,
    profileId,
    c1: cleanHex(body.c1, '#1B365D'),
    c2: cleanHex(body.c2, '#2E6DA4'),
    c3: cleanHex(body.c3, '#FFFFFF'),
    assetIds,
  };
}

export interface PlatformInput {
  platform: string;
  format: string;
  audience: string;
  tone: string;
  visualStyle: string;
  cta: string;
  copySource: CopySource;
  headline: string;
  subline: string;
  avoid: string;
  copyPrompt: string;
  imageModel: ImageModel;
}

export function parsePlatform(body: Record<string, unknown>): PlatformInput | { error: string } {
  const platform = typeof body.platform === 'string' && PLATFORMS[body.platform] ? body.platform : 'Meta (Facebook/Instagram)';
  const formats = PLATFORMS[platform];
  const format = typeof body.format === 'string' && formats.includes(body.format) ? body.format : formats[0];
  const copySource = oneOf(body.copySource, COPY_SOURCES, 'ai');
  return {
    platform,
    format,
    audience: cleanText(body.audience, MAX_SHORT),
    tone: oneOf(body.tone, TONES, 'Professional'),
    visualStyle: oneOf(body.visualStyle, VISUAL_STYLES, 'Clean / minimal'),
    cta: cleanText(body.cta, 80) || 'Get started',
    copySource,
    headline: cleanText(body.headline, MAX_SHORT),
    subline: cleanText(body.subline, MAX_SHORT),
    avoid: cleanText(body.avoid, MAX_TEXT),
    copyPrompt: cleanText(body.copyPrompt, MAX_TEXT),
    imageModel: canonicalImageModel(body.imageModel),
  };
}

export interface VersionPatch {
  headline?: string;
  sub?: string;
  primary?: string;
  cta?: string;
  layout?: Layout;
  bg?: Background;
  c1?: string;
  c2?: string;
  c3?: string;
  size?: string;
}

export function parseVersionPatch(body: Record<string, unknown>): VersionPatch {
  const patch: VersionPatch = {};
  if ('headline' in body) patch.headline = cleanText(body.headline, MAX_SHORT);
  if ('sub' in body) patch.sub = cleanText(body.sub, MAX_SHORT);
  if ('primary' in body) patch.primary = cleanText(body.primary, MAX_TEXT);
  if ('cta' in body) patch.cta = cleanText(body.cta, 80) || 'Get started';
  if ('layout' in body && typeof body.layout === 'string' && (LAYOUTS as readonly string[]).includes(body.layout)) {
    patch.layout = body.layout as Layout;
  }
  if ('bg' in body && typeof body.bg === 'string' && (BACKGROUNDS as readonly string[]).includes(body.bg)) {
    patch.bg = body.bg as Background;
  }
  if ('c1' in body) patch.c1 = cleanHex(body.c1, '#1B365D');
  if ('c2' in body) patch.c2 = cleanHex(body.c2, '#2E6DA4');
  if ('c3' in body) patch.c3 = cleanHex(body.c3, '#FFFFFF');
  if ('size' in body && typeof body.size === 'string' && (SIZES as readonly string[]).includes(body.size)) {
    patch.size = body.size;
  }
  return patch;
}

export interface ProfileInput {
  name: string;
  brandName: string;
  product: string;
  guidelineUrl: string | null;
  c1: string;
  c2: string;
  c3: string;
  assetIds: string[];
  overwrite: boolean;
}

export function parseProfile(body: Record<string, unknown>): ProfileInput | { error: string } {
  const name = cleanText(body.name, MAX_NAME);
  if (name === '') return { error: 'Enter a name for the profile.' };
  const guidelineUrl = body.guidelineUrl === undefined || body.guidelineUrl === '' ? null : cleanHttpUrl(body.guidelineUrl);
  if (body.guidelineUrl && body.guidelineUrl !== '' && guidelineUrl === null) {
    return { error: 'Guidelines link must be an http or https URL.' };
  }
  return {
    name,
    brandName: cleanText(body.brandName, MAX_NAME),
    product: cleanText(body.product, MAX_NAME),
    guidelineUrl,
    c1: cleanHex(body.c1, '#1B365D'),
    c2: cleanHex(body.c2, '#2E6DA4'),
    c3: cleanHex(body.c3, '#FFFFFF'),
    assetIds: Array.isArray(body.assetIds) ? body.assetIds.filter(isId).slice(0, 20) : [],
    overwrite: body.overwrite === true,
  };
}

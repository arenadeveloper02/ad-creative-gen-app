import type { AdAsset, AdProject, AdVersion, BrandProfile } from '@prisma/client';
import { parseRenderAssetIds } from '@/lib/guard';
import { readImageFinish } from '@/lib/image-finish';
import type { AssetDTO, ProfileDTO, ProjectDTO, ProjectListItem, VersionDTO } from '@/lib/types';
import type { Background, CopySource, Layout } from '@/lib/platforms';

type AssetRow = Pick<AdAsset, 'id' | 'kind' | 'name' | 'mimeType' | 'size'>;

const assetSelect = { id: true, kind: true, name: true, mimeType: true, size: true } as const;

export const projectInclude = {
  assets: { select: assetSelect, orderBy: { createdAt: 'asc' as const } },
  versions: { orderBy: { position: 'asc' as const } },
};

export const profileInclude = {
  assets: { select: assetSelect, orderBy: { createdAt: 'asc' as const } },
};

function assetDTO(row: AssetRow): AssetDTO {
  return { id: row.id, kind: row.kind, name: row.name, mimeType: row.mimeType, size: row.size };
}

function versionDTO(row: AdVersion): VersionDTO {
  return {
    id: row.id,
    position: row.position,
    headline: row.headline,
    sub: row.sub,
    primary: row.primary,
    cta: row.cta,
    layout: row.layout as Layout,
    bg: row.bg as Background,
    c1: row.c1,
    c2: row.c2,
    c3: row.c3,
    size: row.size,
    imageUrl: row.imageUrl,
    imagePrompt: row.imagePrompt,
    imageError: row.imageError,
    headlineX: row.headlineX,
    headlineY: row.headlineY,
    subX: row.subX,
    subY: row.subY,
    ctaX: row.ctaX,
    ctaY: row.ctaY,
    logoX: row.logoX ?? null,
    logoY: row.logoY ?? null,
    logoAssetId: row.logoAssetId ?? null,
    fontAssetId: row.fontAssetId ?? null,
    imageZoom: typeof row.imageZoom === 'number' && Number.isFinite(row.imageZoom) ? row.imageZoom : 1,
    imageFocusX: row.imageFocusX ?? null,
    imageFocusY: row.imageFocusY ?? null,
    imageFinish: readImageFinish(row.imageFinish),
    imagePrevUrl: typeof row.imagePrevUrl === 'string' && /^https:\/\//i.test(row.imagePrevUrl) ? row.imagePrevUrl : null,
    showLogo: row.showLogo !== false,
    showHeadline: row.showHeadline,
    showSub: row.showSub,
    showCta: row.showCta,
    headlineBold: row.headlineBold ?? true,
    headlineItalic: row.headlineItalic ?? false,
    headlineScale: row.headlineScale ?? 1,
    headlineTrack: row.headlineTrack ?? 0,
    headlineLead: row.headlineLead ?? 1,
    subBold: row.subBold ?? false,
    subItalic: row.subItalic ?? false,
    subScale: row.subScale ?? 1,
    subTrack: row.subTrack ?? 0,
    subLead: row.subLead ?? 1,
    ctaBold: row.ctaBold ?? true,
    ctaItalic: row.ctaItalic ?? false,
    ctaScale: row.ctaScale ?? 1,
    ctaTrack: row.ctaTrack ?? 0,
    ctaLead: row.ctaLead ?? 1,
  };
}

export function serializeProject(row: AdProject & { assets: AssetRow[]; versions: AdVersion[] }): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sceneNote: row.sceneNote,
    goal: row.goal,
    brandName: row.brandName,
    product: row.product,
    guidelineUrl: row.guidelineUrl ?? '',
    profileId: row.profileId,
    c1: row.c1,
    c2: row.c2,
    c3: row.c3,
    platform: row.platform,
    format: row.format,
    audience: row.audience,
    tone: row.tone,
    visualStyle: row.visualStyle,
    cta: row.cta,
    copySource: row.copySource === 'manual' ? 'manual' : 'ai',
    headline: row.headline,
    subline: row.subline,
    avoid: row.avoid,
    copyPrompt: row.copyPrompt,
    imageModel: row.imageModel,
    imageResolution: row.imageResolution,
    renderAssetIds: parseRenderAssetIds(row.renderAssetIds),
    step: row.step,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    assets: row.assets.map(assetDTO),
    versions: row.versions.map(versionDTO),
  };
}

export function serializeProfile(row: BrandProfile & { assets: AssetRow[] }): ProfileDTO {
  return {
    id: row.id,
    name: row.name,
    brandName: row.brandName,
    product: row.product,
    guidelineUrl: row.guidelineUrl ?? '',
    c1: row.c1,
    c2: row.c2,
    c3: row.c3,
    assets: row.assets.map(assetDTO),
  };
}

export function serializeListItem(
  row: Pick<AdProject, 'id' | 'name' | 'platform' | 'format' | 'imageResolution' | 'status' | 'step' | 'createdAt' | 'updatedAt'> & {
    versions?: { imageUrl: string | null; size: string }[];
  },
): ProjectListItem {
  const preview = row.versions?.find((version) => typeof version.imageUrl === 'string' && /^https:\/\//i.test(version.imageUrl));
  const lead = row.versions?.[0];
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    format: row.format,
    imageResolution: row.imageResolution,
    size: lead?.size ?? null,
    status: row.status,
    step: row.step,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    previewImageUrl: preview?.imageUrl ?? null,
  };
}

export function asCopySource(value: string): CopySource {
  return value === 'manual' ? 'manual' : 'ai';
}

import type { AdAsset, AdProject, AdVersion, BrandProfile } from '@prisma/client';
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
    showHeadline: row.showHeadline,
    showSub: row.showSub,
    showCta: row.showCta,
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

export function serializeListItem(row: Pick<AdProject, 'id' | 'name' | 'platform' | 'status' | 'step' | 'updatedAt'>): ProjectListItem {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
    step: row.step,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function asCopySource(value: string): CopySource {
  return value === 'manual' ? 'manual' : 'ai';
}

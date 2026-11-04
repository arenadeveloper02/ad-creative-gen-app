import type { Background, CopySource, Layout } from '@/lib/platforms';

export interface WhyItWorksPoint {
  title: string;
  description: string;
}

export interface AdCreative {
  product: string;
  platform: string;
  tone: string;
  cta: string;
  headline: string;
  body: string;
  hashtags: string[];
  imageAlt: string;
  whyItWorks: WhyItWorksPoint[];
}

export type ExportResult = { success: boolean; error?: string };

export interface AssetDTO {
  id: string;
  kind: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface VersionDTO {
  id: string;
  position: number;
  headline: string;
  sub: string;
  primary: string;
  cta: string;
  layout: Layout;
  bg: Background;
  c1: string;
  c2: string;
  c3: string;
  size: string;
  imageUrl: string | null;
  imagePrompt: string | null;
  imageError: string | null;
  headlineX: number | null;
  headlineY: number | null;
  subX: number | null;
  subY: number | null;
  ctaX: number | null;
  ctaY: number | null;
  showHeadline: boolean;
  showSub: boolean;
  showCta: boolean;
  headlineBold: boolean;
  headlineItalic: boolean;
  headlineScale: number;
  subBold: boolean;
  subItalic: boolean;
  subScale: number;
  ctaBold: boolean;
  ctaItalic: boolean;
  ctaScale: number;
}

export interface ProjectDTO {
  id: string;
  name: string;
  description: string;
  sceneNote: string;
  goal: string;
  brandName: string;
  product: string;
  guidelineUrl: string;
  profileId: string | null;
  c1: string;
  c2: string;
  c3: string;
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
  imageModel: string;
  imageResolution: string;
  /** Asset ids the user picked for the final render (logos / fonts / reference creatives). */
  renderAssetIds: string[];
  step: number;
  status: string;
  updatedAt: string;
  assets: AssetDTO[];
  versions: VersionDTO[];
}

export interface ProfileDTO {
  id: string;
  name: string;
  brandName: string;
  product: string;
  guidelineUrl: string;
  c1: string;
  c2: string;
  c3: string;
  assets: AssetDTO[];
}

export interface ProjectListItem {
  id: string;
  name: string;
  platform: string;
  status: string;
  step: number;
  createdAt: string;
  updatedAt: string;
  /** First generated version image, when the ad has one. */
  previewImageUrl: string | null;
}

export interface UsageRow {
  id: string;
  projectId: string | null;
  kind: string;
  provider: string;
  model: string;
  estimatedUsd: number;
  createdAt: string;
}

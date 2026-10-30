import type { AdAsset, AdProject, AdVersion } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { falKey, runFalJob } from '@/lib/fal';
import { buildImageJob, readImageUrl } from '@/lib/fal-models';
import { buildImagePrompt } from '@/lib/image-prompt';
import { isRecord } from '@/lib/json';
import { logUsage, reportFalUsage } from '@/lib/usage';
import type { Layout } from '@/lib/platforms';

type AssetMeta = Pick<AdAsset, 'id' | 'kind' | 'mimeType'>;

const REF_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function clipNote(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 700) : '';
}

/** Brand files live in Postgres; Fal needs a public URL, so each is uploaded to Fal storage once per generation. */
async function uploadAssetToFal(assetId: string): Promise<string | null> {
  const key = falKey();
  if (key === '') return null;
  const asset = await prisma.adAsset.findUnique({ where: { id: assetId }, select: { data: true, mimeType: true, name: true } });
  if (!asset || !REF_MIMES.has(asset.mimeType)) return null;
  try {
    const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
      method: 'POST',
      headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: asset.name, content_type: asset.mimeType }),
    });
    if (!init.ok) return null;
    const data = (await init.json()) as { upload_url?: string; file_url?: string };
    if (!data.upload_url || !data.file_url) return null;
    const put = await fetch(data.upload_url, { method: 'PUT', headers: { 'Content-Type': asset.mimeType }, body: new Uint8Array(asset.data) });
    return put.ok ? data.file_url : null;
  } catch {
    return null;
  }
}

async function referenceUrls(assets: AssetMeta[]): Promise<{ urls: string[]; hasLogo: boolean; hasReferences: boolean }> {
  const logos = assets.filter((a) => a.kind === 'logos' && REF_MIMES.has(a.mimeType)).slice(0, 1);
  const refs = assets.filter((a) => a.kind === 'refs' && REF_MIMES.has(a.mimeType)).slice(0, 3);
  const uploaded = await Promise.all([...logos, ...refs].map((a) => uploadAssetToFal(a.id)));
  const urls = uploaded.filter((u): u is string => typeof u === 'string');
  return { urls, hasLogo: logos.length > 0 && urls.length > 0, hasReferences: refs.length > 0 && urls.length > 0 };
}

export interface GenerateImageResult {
  ok: boolean;
  imageUrl: string | null;
  prompt: string;
  error: string | null;
}

/** Generates one Fal image for a version and stores the result on the row. Every image, including an edit, uses Nano Banana Pro at 4K. */
export async function generateVersionImage(opts: {
  project: AdProject & { assets: AssetMeta[] };
  version: Pick<AdVersion, 'id' | 'position' | 'layout' | 'size' | 'c1' | 'c2' | 'c3' | 'imageUrl'>;
  ownerEmail: string;
  editPrompt?: string;
  onThought?: (text: string) => void;
}): Promise<GenerateImageResult> {
  const { project, version } = opts;
  const note = opts.onThought ?? (() => undefined);
  const label = `Version ${String.fromCharCode(65 + version.position)}`;
  const change = opts.editPrompt?.trim() ?? '';
  if (change !== '') {
    if (!version.imageUrl || !/^https:\/\//i.test(version.imageUrl)) {
      return { ok: false, imageUrl: null, prompt: change, error: 'This version has no image to edit yet.' };
    }
    const prompt = [
      'Edit the attached advertising image.',
      `Change only this: ${change}`,
      'Keep the same people, product, logo, colours, and framing.',
      'Do not add any words, letters, captions, or watermarks.',
    ].join('\n');
    note(`${label}: editing this image only. ${change}`);
    const job = buildImageJob({ prompt, size: version.size, model: 'nano-banana-pro', referenceImageUrls: [version.imageUrl] });
    const run = await runFalJob(job.endpoint, job.input, 180000, (update) => {
      if (update.logs.length > 0) note(`${label}: ${update.logs.join(' ')}`);
      else if (update.status) note(`${label}: Fal is ${update.status.toLowerCase().replace(/_/g, ' ')}.`);
    });
    const imageUrl = run.ok ? readImageUrl(run.output) : null;
    const error = run.ok ? (imageUrl ? null : 'Fal returned no image.') : (run.error ?? 'Image generation failed.');
    await prisma.adVersion.update({
      where: { id: version.id },
      data: { imageUrl: imageUrl ?? version.imageUrl, imagePrompt: prompt, imageModel: job.endpoint, imageError: error },
    });
    if (imageUrl) {
      await logUsage({
        ownerEmail: opts.ownerEmail,
        projectId: project.id,
        kind: 'image',
        provider: 'fal',
        model: 'nano-banana-pro',
        meta: { versionId: version.id, endpoint: job.endpoint, requestId: run.requestId, edit: true },
      });
      if (run.requestId) await reportFalUsage({ email: opts.ownerEmail, endpointId: run.endpointId, requestId: run.requestId });
    }
    return { ok: imageUrl !== null, imageUrl, prompt, error };
  }

  const model = 'nano-banana-pro' as const;
  note(`${label}: checking the logo and reference files.`);
  const refs = await referenceUrls(project.assets);
  note(refs.urls.length > 0
    ? `${label}: ${refs.urls.length} brand file${refs.urls.length === 1 ? '' : 's'} uploaded for the model to see.`
    : `${label}: no logo or reference image on this ad, so the brief carries the look.`);
  const prompt = buildImagePrompt({
    description: project.description,
    sceneNote: project.sceneNote,
    goal: project.goal,
    brandName: project.brandName,
    product: project.product,
    platform: project.platform,
    format: project.format,
    audience: project.audience,
    tone: project.tone,
    visualStyle: project.visualStyle,
    avoid: project.avoid,
    c1: version.c1,
    c2: version.c2,
    c3: version.c3,
    layout: version.layout as Layout,
    hasLogo: refs.hasLogo,
    hasReferences: refs.hasReferences,
    variant: version.position,
  });

  note(`${label}: sending this prompt to Nano Banana Pro at 4K.\n${prompt}`);
  const job = buildImageJob({ prompt, size: version.size, model, referenceImageUrls: refs.urls });
  const run = await runFalJob(job.endpoint, job.input, 180000, (update) => {
    if (update.logs.length > 0) note(`${label}: ${update.logs.join(' ')}`);
    else if (update.status) note(`${label}: Fal is ${update.status.toLowerCase().replace(/_/g, ' ')}.`);
  });
  const imageUrl = run.ok ? readImageUrl(run.output) : null;
  const error = run.ok ? (imageUrl ? null : 'Fal returned no image.') : (run.error ?? 'Image generation failed.');
  const described = run.ok && isRecord(run.output) ? clipNote(run.output.description) : '';
  if (described) note(`${label}: the model said — ${described}`);
  note(imageUrl ? `${label}: the picture is ready.` : `${label}: the picture failed. ${error ?? ''}`);

  await prisma.adVersion.update({
    where: { id: version.id },
    data: { imageUrl, imagePrompt: prompt, imageModel: job.endpoint, imageError: error },
  });

  if (imageUrl) {
    await logUsage({
      ownerEmail: opts.ownerEmail,
      projectId: project.id,
      kind: 'image',
      provider: 'fal',
      model,
      meta: { versionId: version.id, endpoint: job.endpoint, requestId: run.requestId },
    });
    if (run.requestId) {
      await reportFalUsage({ email: opts.ownerEmail, endpointId: run.endpointId, requestId: run.requestId });
    }
  }

  return { ok: imageUrl !== null, imageUrl, prompt, error };
}

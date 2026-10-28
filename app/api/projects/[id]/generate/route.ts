import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { draftVersion, type CopyInput, type VersionDraft } from '@/lib/copy';
import { falConfigError } from '@/lib/fal';
import { generateVersionImage } from '@/lib/generate-image';
import { writeAdCopy } from '@/lib/write-copy';
import { cleanText, isId } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { MAX_VERSIONS } from '@/lib/limits';
import { projectInclude, serializeProject, asCopySource } from '@/lib/serialize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const projectWithAssets = {
  versions: { orderBy: { position: 'asc' as const } },
  assets: { select: { id: true, kind: true, mimeType: true } },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const mode = body.mode === 'append' || body.mode === 'rewrite' || body.mode === 'image' || body.mode === 'refresh' ? body.mode : 'replace';

  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: projectWithAssets });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const owned = project;

  const input: CopyInput = {
    product: project.product,
    brand: project.brandName,
    goal: project.goal,
    tone: project.tone,
    audience: project.audience,
    description: project.description,
    cta: project.cta,
    copySource: asCopySource(project.copySource),
    headline: project.headline,
    subline: project.subline,
  };

  async function resolveDrafts(count: number, startIndex: number, currentHeadline?: string): Promise<{ ok: true; drafts: VersionDraft[] } | { ok: false; error: string }> {
    if (input.copySource !== 'ai') {
      return { ok: true, drafts: Array.from({ length: count }, (_, index) => draftVersion(input, startIndex + index, owned.format)) };
    }
    const cfg = falConfigError();
    if (cfg) return { ok: false, error: cfg };
    const written = await writeAdCopy({ project: owned, count, currentHeadline, ownerEmail: email });
    if (!written.ok) return written;
    return {
      ok: true,
      drafts: written.lines.map((line, index) => ({
        ...draftVersion(input, startIndex + index, owned.format),
        headline: line.headline,
        sub: line.sub,
        primary: line.primary,
      })),
    };
  }

  if (mode === 'rewrite') {
    if (!isId(body.versionId)) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const version = project.versions.find((item) => item.id === body.versionId);
    if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const resolved = await resolveDrafts(1, version.position + 1, version.headline);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
    const draft = resolved.drafts[0];
    await prisma.adVersion.update({ where: { id: version.id }, data: { headline: draft.headline, sub: draft.sub, primary: draft.primary } });
  } else if (mode === 'image') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    if (!isId(body.versionId)) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const version = project.versions.find((item) => item.id === body.versionId);
    if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const editPrompt = cleanText(body.editPrompt, 1000);
    const result = await generateVersionImage({ project, version, ownerEmail: email, editPrompt });
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'Image generation failed.' }, { status: 502 });
  } else if (mode === 'refresh') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    const extra = project.versions.filter((item) => item.position >= 2);
    if (extra.length > 0) {
      await prisma.adVersion.deleteMany({ where: { id: { in: extra.map((item) => item.id) } } });
    }
    const keep = project.versions.filter((item) => item.position < 2);
    const results = await Promise.all(keep.map((version) => generateVersionImage({ project, version, ownerEmail: email })));
    const failed = results.find((item) => !item.ok);
    if (failed && results.every((item) => !item.ok)) {
      return NextResponse.json({ error: failed.error ?? 'Image generation failed.' }, { status: 502 });
    }
  } else if (mode === 'append') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    if (project.versions.length >= MAX_VERSIONS) {
      return NextResponse.json({ error: `You can keep up to ${MAX_VERSIONS} versions.` }, { status: 400 });
    }
    const resolved = await resolveDrafts(1, project.versions.length);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
    const draft = resolved.drafts[0];
    const created = await prisma.adVersion.create({
      data: { projectId: project.id, position: project.versions.length, ...draft, c1: project.c1, c2: project.c2, c3: project.c3 },
    });
    await generateVersionImage({ project, version: created, ownerEmail: email });
  } else {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    const resolved = await resolveDrafts(2, 0);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
    const drafts = resolved.drafts;
    const created = await prisma.$transaction(async (tx) => {
      await tx.adVersion.deleteMany({ where: { projectId: project.id } });
      const rows = [];
      for (const [position, draft] of drafts.entries()) {
        rows.push(await tx.adVersion.create({ data: { projectId: project.id, position, ...draft, c1: project.c1, c2: project.c2, c3: project.c3 } }));
      }
      await tx.adProject.update({ where: { id: project.id }, data: { step: 3, status: 'generated' } });
      return rows;
    });
    const results = await Promise.all(created.map((version) => generateVersionImage({ project, version, ownerEmail: email })));
    const failed = results.find((r) => !r.ok);
    if (failed && results.every((r) => !r.ok)) {
      return NextResponse.json({ error: failed.error ?? 'Image generation failed.' }, { status: 502 });
    }
  }

  const full = await prisma.adProject.findFirst({ where: { id: project.id, ownerEmail: email }, include: projectInclude });
  if (!full) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(full));
}

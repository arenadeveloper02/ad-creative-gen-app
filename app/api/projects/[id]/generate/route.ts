import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { draftVersion, type CopyInput } from '@/lib/copy';
import { isId } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { MAX_VERSIONS } from '@/lib/limits';
import { projectInclude, serializeProject, asCopySource } from '@/lib/serialize';
import { logUsage } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const mode = body.mode === 'append' || body.mode === 'rewrite' ? body.mode : 'replace';

  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: { versions: { orderBy: { position: 'asc' } } } });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

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

  if (mode === 'rewrite') {
    if (!isId(body.versionId)) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const version = project.versions.find((item) => item.id === body.versionId);
    if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const draft = draftVersion(input, version.position + 1, project.format);
    await prisma.adVersion.update({
      where: { id: version.id },
      data: { headline: draft.headline, sub: draft.sub, primary: draft.primary },
    });
    await logUsage({ ownerEmail: email, projectId: project.id, kind: 'image', provider: 'studio', model: 'rewrite', meta: { versionId: version.id } });
  } else if (mode === 'append') {
    if (project.versions.length >= MAX_VERSIONS) {
      return NextResponse.json({ error: `You can keep up to ${MAX_VERSIONS} versions.` }, { status: 400 });
    }
    const draft = draftVersion(input, project.versions.length, project.format);
    const created = await prisma.adVersion.create({
      data: { projectId: project.id, position: project.versions.length, ...draft, c1: project.c1, c2: project.c2, c3: project.c3 },
    });
    await logUsage({ ownerEmail: email, projectId: project.id, kind: 'image', provider: 'studio', model: 'compose', meta: { versionId: created.id } });
  } else {
    const drafts = [0, 1].map((index) => draftVersion(input, index, project.format));
    await prisma.$transaction(async (tx) => {
      await tx.adVersion.deleteMany({ where: { projectId: project.id } });
      await tx.adVersion.createMany({
        data: drafts.map((draft, position) => ({ projectId: project.id, position, ...draft, c1: project.c1, c2: project.c2, c3: project.c3 })),
      });
      await tx.adProject.update({ where: { id: project.id }, data: { step: 3, status: 'generated' } });
    });
    await logUsage({ ownerEmail: email, projectId: project.id, kind: 'image', provider: 'studio', model: 'compose', meta: { count: 2 } });
  }

  const full = await prisma.adProject.findFirst({ where: { id: project.id, ownerEmail: email }, include: projectInclude });
  if (!full) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(full));
}

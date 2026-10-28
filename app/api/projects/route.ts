import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { listProjects, claimAssets } from '@/lib/actions';
import { parseBrief } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { projectInclude, serializeProject } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  return NextResponse.json(await listProjects(email));
}

export async function POST(req: Request): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const brief = parseBrief(body);
  if ('error' in brief) return NextResponse.json({ error: brief.error }, { status: 400 });

  if (brief.profileId) {
    const profile = await prisma.brandProfile.findFirst({ where: { id: brief.profileId, ownerEmail: email }, select: { id: true } });
    if (!profile) return NextResponse.json({ error: 'Brand profile not found.' }, { status: 404 });
  }

  const name = brief.product || brief.brandName || 'Untitled ad';
  const created = await prisma.adProject.create({
    data: {
      ownerEmail: email,
      name: name.slice(0, 120),
      description: brief.description,
      goal: brief.goal,
      brandName: brief.brandName,
      product: brief.product,
      guidelineUrl: brief.guidelineUrl,
      profileId: brief.profileId,
      c1: brief.c1,
      c2: brief.c2,
      c3: brief.c3,
      step: 2,
      status: 'draft',
    },
  });
  const claimed = await claimAssets(email, brief.assetIds, { projectId: created.id });
  if (!claimed.ok) {
    await prisma.adProject.delete({ where: { id: created.id } });
    return NextResponse.json({ error: claimed.error }, { status: 400 });
  }
  const full = await prisma.adProject.findFirst({ where: { id: created.id, ownerEmail: email }, include: projectInclude });
  if (!full) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(full));
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { isId, parseBrief, parsePlatform } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { projectInclude, serializeProject } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

async function loadOwned(id: string) {
  const email = await currentOwnerEmail();
  if (!isId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const row = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: projectInclude });
  if (!row) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return row;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadOwned(id);
  if (loaded instanceof NextResponse) return loaded;
  return NextResponse.json(serializeProject(loaded));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadOwned(id);
  if (loaded instanceof NextResponse) return loaded;
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const data: Record<string, string | number | null> = {};
  if ('description' in body || 'goal' in body || 'brandName' in body) {
    const brief = parseBrief({ ...loaded, ...body, assetIds: [] });
    if ('error' in brief) return NextResponse.json({ error: brief.error }, { status: 400 });
    data.description = brief.description;
    data.goal = brief.goal;
    data.brandName = brief.brandName;
    data.product = brief.product;
    data.guidelineUrl = brief.guidelineUrl;
    data.c1 = brief.c1;
    data.c2 = brief.c2;
    data.c3 = brief.c3;
    const name = brief.product || brief.brandName;
    if (name) data.name = name.slice(0, 120);
  }
  if ('platform' in body || 'format' in body || 'tone' in body || 'copySource' in body || 'copyPrompt' in body || 'imageModel' in body) {
    const platform = parsePlatform({ ...loaded, ...body });
    if ('error' in platform) return NextResponse.json({ error: platform.error }, { status: 400 });
    Object.assign(data, platform);
  }
  if (typeof body.step === 'number' && Number.isFinite(body.step)) {
    data.step = Math.min(3, Math.max(1, Math.round(body.step)));
  }

  const updated = await prisma.adProject.update({
    where: { id: loaded.id },
    data,
    include: projectInclude,
  });
  return NextResponse.json(serializeProject(updated));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadOwned(id);
  if (loaded instanceof NextResponse) return loaded;
  await prisma.adProject.delete({ where: { id: loaded.id } });
  return NextResponse.json({ ok: true });
}

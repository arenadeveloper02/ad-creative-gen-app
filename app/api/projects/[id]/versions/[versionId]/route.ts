import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getArenaEmailId } from '@/lib/arena-email';
import { isId, parseVersionPatch } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { projectInclude, serializeProject } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

async function ownedVersion(projectId: string, versionId: string, email: string) {
  if (!isId(projectId) || !isId(versionId)) return null;
  return prisma.adVersion.findFirst({
    where: { id: versionId, projectId, project: { ownerEmail: email } },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id, versionId } = await params;
  const version = await ownedVersion(id, versionId, email);
  if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  await prisma.adVersion.update({ where: { id: version.id }, data: parseVersionPatch(body) });
  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: projectInclude });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(project));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id, versionId } = await params;
  const version = await ownedVersion(id, versionId, email);
  if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
  const count = await prisma.adVersion.count({ where: { projectId: id } });
  if (count <= 1) return NextResponse.json({ error: 'Keep at least one version.' }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.adVersion.delete({ where: { id: version.id } });
    const rest = await tx.adVersion.findMany({ where: { projectId: id }, orderBy: { position: 'asc' } });
    for (const item of rest) {
      await tx.adVersion.update({ where: { id: item.id }, data: { position: item.position + 100 } });
    }
    const shifted = await tx.adVersion.findMany({ where: { projectId: id }, orderBy: { position: 'asc' } });
    for (let i = 0; i < shifted.length; i += 1) {
      await tx.adVersion.update({ where: { id: shifted[i].id }, data: { position: i } });
    }
  });

  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: projectInclude });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(project));
}

import { prisma } from '@/lib/prisma';
import { isId } from '@/lib/guard';
import { profileInclude, projectInclude, serializeListItem, serializeProfile, serializeProject } from '@/lib/serialize';
import type { ExportResult, ProfileDTO, ProjectDTO, ProjectListItem } from '@/lib/types';

export async function logExport(platform: string, product: string): Promise<ExportResult> {
  const safePlatform = platform.trim().slice(0, 80);
  const safeProduct = product.trim().slice(0, 120);
  if (safePlatform === '' || safeProduct === '') return { success: false, error: 'Failed to log export event' };
  try {
    await prisma.exportLog.create({ data: { platform: safePlatform, product: safeProduct } });
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to log export event' };
  }
}

export async function getExportCount(): Promise<number> {
  try {
    return await prisma.exportLog.count();
  } catch {
    return 0;
  }
}

export async function listProjects(ownerEmail: string): Promise<ProjectListItem[]> {
  if (ownerEmail === '') return [];
  const rows = await prisma.adProject.findMany({
    where: { ownerEmail },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, platform: true, status: true, step: true, updatedAt: true },
  });
  return rows.map(serializeListItem);
}

export async function getOwnedProject(id: string, ownerEmail: string): Promise<ProjectDTO | null> {
  if (!isId(id) || ownerEmail === '') return null;
  const row = await prisma.adProject.findFirst({ where: { id, ownerEmail }, include: projectInclude });
  return row ? serializeProject(row) : null;
}

export async function listProfiles(ownerEmail: string): Promise<ProfileDTO[]> {
  if (ownerEmail === '') return [];
  const rows = await prisma.brandProfile.findMany({
    where: { ownerEmail },
    orderBy: { name: 'asc' },
    include: profileInclude,
  });
  return rows.map(serializeProfile);
}

/** Attaches only unassigned files that already belong to this email. */
export async function claimAssets(ownerEmail: string, ids: string[], target: { projectId: string } | { profileId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: true };
  if (unique.some((id) => !isId(id))) return { ok: false, error: 'Invalid file.' };
  const rows = await prisma.adAsset.findMany({
    where: { id: { in: unique }, ownerEmail, projectId: null, profileId: null },
    select: { id: true },
  });
  if (rows.length !== unique.length) return { ok: false, error: 'One of those files is not available.' };
  await prisma.adAsset.updateMany({
    where: { id: { in: unique }, ownerEmail, projectId: null, profileId: null },
    data: target,
  });
  return { ok: true };
}

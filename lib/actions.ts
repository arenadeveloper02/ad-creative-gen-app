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
    select: {
      id: true,
      name: true,
      platform: true,
      status: true,
      step: true,
      createdAt: true,
      updatedAt: true,
      versions: {
        orderBy: { position: 'asc' },
        take: 4,
        select: { imageUrl: true },
      },
    },
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

/**
 * Puts the given assets on a brand profile.
 * Unassigned files are claimed; files already on this profile are kept;
 * files on a project (or another profile) are copied so Use existing stays complete.
 */
export async function attachAssetsToProfile(
  ownerEmail: string,
  ids: string[],
  profileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: true };
  if (unique.some((id) => !isId(id))) return { ok: false, error: 'Invalid file.' };
  const rows = await prisma.adAsset.findMany({
    where: { id: { in: unique }, ownerEmail },
    select: { id: true, kind: true, name: true, mimeType: true, size: true, data: true, projectId: true, profileId: true },
  });
  // Attach whatever still exists. Missing ids are usually from a draft race; failing the whole save is worse.
  if (rows.length === 0) return { ok: false, error: 'One of those files is not available.' };

  const claimIds: string[] = [];
  const clones: typeof rows = [];
  for (const row of rows) {
    if (row.profileId === profileId) continue;
    if (row.projectId === null && row.profileId === null) {
      claimIds.push(row.id);
      continue;
    }
    clones.push(row);
  }

  if (claimIds.length) {
    await prisma.adAsset.updateMany({
      where: { id: { in: claimIds }, ownerEmail, projectId: null, profileId: null },
      data: { profileId },
    });
  }
  // One row at a time. A single createMany of every logo, font and creative exceeds Postgres' query size and comes back as HTTP 500.
  for (const row of clones) {
    await prisma.adAsset.create({
      data: {
        ownerEmail,
        profileId,
        kind: row.kind,
        name: row.name,
        mimeType: row.mimeType,
        size: row.size,
        data: row.data,
      },
    });
  }
  return { ok: true };
}

/** Copies any missing profile files onto the project so Use existing feeds generation. */
export async function ensureProfileAssetsOnProject(
  ownerEmail: string,
  profileId: string,
  projectId: string,
): Promise<void> {
  const profileAssets = await prisma.adAsset.findMany({ where: { ownerEmail, profileId } });
  if (profileAssets.length === 0) return;
  const projectAssets = await prisma.adAsset.findMany({
    where: { ownerEmail, projectId },
    select: { kind: true, name: true, size: true },
  });
  const have = new Set(projectAssets.map((row) => `${row.kind}|${row.name}|${row.size}`));
  const missing = profileAssets.filter((row) => !have.has(`${row.kind}|${row.name}|${row.size}`));
  for (const row of missing) {
    await prisma.adAsset.create({
      data: {
        ownerEmail,
        projectId,
        kind: row.kind,
        name: row.name,
        mimeType: row.mimeType,
        size: row.size,
        data: row.data,
      },
    });
  }
}

function fingerprint(row: { kind: string; name: string; size: number }): string {
  return `${row.kind}|${row.name}|${row.size}`;
}

/**
 * Makes the project's files match the brief's current brand.
 * Claims or copies the keep-list first, then drops anything else (old Apple files, etc.).
 * An empty keep-list is ignored — never wipe the project. That empty list was racing with
 * Fill with AI and deleting logos before Save profile could attach them.
 */
export async function syncBriefAssets(
  ownerEmail: string,
  projectId: string,
  assetIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const unique = [...new Set(assetIds.filter(isId))];
  if (unique.length === 0) return { ok: true };

  const keepRows = await prisma.adAsset.findMany({
    where: { id: { in: unique }, ownerEmail },
    select: { id: true, kind: true, name: true, mimeType: true, size: true, data: true, projectId: true, profileId: true },
  });
  // If every id is already gone, do not delete the project's current files.
  if (keepRows.length === 0) return { ok: true };

  const claimIds = keepRows.filter((row) => row.projectId === null && row.profileId === null).map((row) => row.id);
  if (claimIds.length > 0) {
    await prisma.adAsset.updateMany({
      where: { id: { in: claimIds }, ownerEmail, projectId: null, profileId: null },
      data: { projectId },
    });
  }

  const already = await prisma.adAsset.findMany({
    where: { ownerEmail, projectId },
    select: { kind: true, name: true, size: true },
  });
  const have = new Set(already.map(fingerprint));
  for (const row of keepRows) {
    if (row.projectId === projectId || have.has(fingerprint(row))) continue;
    await prisma.adAsset.create({
      data: {
        ownerEmail,
        projectId,
        kind: row.kind,
        name: row.name,
        mimeType: row.mimeType,
        size: row.size,
        data: row.data,
      },
    });
    have.add(fingerprint(row));
  }

  const keepPrints = new Set(keepRows.map(fingerprint));
  const onProject = await prisma.adAsset.findMany({
    where: { ownerEmail, projectId },
    select: { id: true, kind: true, name: true, size: true, profileId: true },
  });
  const drop = onProject.filter((row) => !keepPrints.has(fingerprint(row)));
  const deleteIds = drop.filter((row) => row.profileId === null).map((row) => row.id);
  const unlinkIds = drop.filter((row) => row.profileId !== null).map((row) => row.id);
  if (deleteIds.length > 0) await prisma.adAsset.deleteMany({ where: { id: { in: deleteIds }, ownerEmail } });
  if (unlinkIds.length > 0) await prisma.adAsset.updateMany({ where: { id: { in: unlinkIds }, ownerEmail }, data: { projectId: null } });

  return { ok: true };
}

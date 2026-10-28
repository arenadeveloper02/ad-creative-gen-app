import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getArenaEmailId } from '@/lib/arena-email';
import { claimAssets, listProfiles } from '@/lib/actions';
import { parseProfile } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { profileInclude, serializeProfile } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  return NextResponse.json(await listProfiles(email));
}

export async function POST(req: Request): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const profile = parseProfile(body);
  if ('error' in profile) return NextResponse.json({ error: profile.error }, { status: 400 });

  const existing = await prisma.brandProfile.findFirst({
    where: { ownerEmail: email, name: { equals: profile.name, mode: 'insensitive' } },
  });
  if (existing && !profile.overwrite) {
    return NextResponse.json({ error: `A profile named "${profile.name}" already exists.`, code: 'exists' }, { status: 409 });
  }

  const saved = existing
    ? await prisma.brandProfile.update({
        where: { id: existing.id },
        data: {
          name: profile.name,
          brandName: profile.brandName,
          product: profile.product,
          guidelineUrl: profile.guidelineUrl,
          c1: profile.c1,
          c2: profile.c2,
          c3: profile.c3,
        },
      })
    : await prisma.brandProfile.create({
        data: {
          ownerEmail: email,
          name: profile.name,
          brandName: profile.brandName,
          product: profile.product,
          guidelineUrl: profile.guidelineUrl,
          c1: profile.c1,
          c2: profile.c2,
          c3: profile.c3,
        },
      });

  const claimed = await claimAssets(email, profile.assetIds, { profileId: saved.id });
  if (!claimed.ok) return NextResponse.json({ error: claimed.error }, { status: 400 });
  const full = await prisma.brandProfile.findFirst({ where: { id: saved.id, ownerEmail: email }, include: profileInclude });
  if (!full) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  return NextResponse.json(serializeProfile(full));
}

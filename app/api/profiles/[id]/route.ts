import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getArenaEmailId } from '@/lib/arena-email';
import { claimAssets } from '@/lib/actions';
import { isId, parseProfile } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { profileInclude, serializeProfile } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  const existing = await prisma.brandProfile.findFirst({ where: { id, ownerEmail: email } });
  if (!existing) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const profile = parseProfile({ ...body, name: typeof body.name === 'string' && body.name.trim() !== '' ? body.name : existing.name, overwrite: true });
  if ('error' in profile) return NextResponse.json({ error: profile.error }, { status: 400 });
  await prisma.brandProfile.update({
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
  });
  const claimed = await claimAssets(email, profile.assetIds, { profileId: existing.id });
  if (!claimed.ok) return NextResponse.json({ error: claimed.error }, { status: 400 });
  const full = await prisma.brandProfile.findFirst({ where: { id: existing.id, ownerEmail: email }, include: profileInclude });
  if (!full) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  return NextResponse.json(serializeProfile(full));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  const existing = await prisma.brandProfile.findFirst({ where: { id, ownerEmail: email }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
  await prisma.brandProfile.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}

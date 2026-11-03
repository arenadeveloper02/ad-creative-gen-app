import { NextResponse } from 'next/server';
import { lookupBrandGuidelines } from '@/lib/brand-guidelines';
import { currentOwnerEmail } from '@/lib/arena-email';
import { cleanHttpUrl, cleanText, isId } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { MAX_SHORT } from '@/lib/limits';
import { mimeAllowed } from '@/lib/platforms';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const brandName = cleanText(body.brandName, MAX_SHORT);
  if (brandName.length < 2) return NextResponse.json({ error: 'Enter a brand name first.' }, { status: 400 });

  const websiteRaw = typeof body.website === 'string' ? body.website.trim() : '';
  const website = websiteRaw === '' ? null : cleanHttpUrl(websiteRaw.startsWith('http') ? websiteRaw : `https://${websiteRaw}`);
  if (websiteRaw !== '' && !website) {
    return NextResponse.json({ error: 'Website must be a valid http(s) URL.' }, { status: 400 });
  }

  let projectId: string | null = null;
  let profileId: string | null = null;
  // Leave files unassigned. Linking them to the project here raced with the draft save, which then deleted them.
  const link: { profileId?: string } = {};

  if (typeof body.projectId === 'string' && body.projectId !== '') {
    if (!isId(body.projectId)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const project = await prisma.adProject.findFirst({ where: { id: body.projectId, ownerEmail: email }, select: { id: true } });
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    projectId = project.id;
  } else if (typeof body.profileId === 'string' && body.profileId !== '') {
    if (!isId(body.profileId)) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    const profile = await prisma.brandProfile.findFirst({ where: { id: body.profileId, ownerEmail: email }, select: { id: true } });
    if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    profileId = profile.id;
    link.profileId = profile.id;
  }

  const looked = await lookupBrandGuidelines({
    brandName,
    website,
    ownerEmail: email,
    projectId,
  });
  if (!looked.ok) return NextResponse.json({ error: looked.error }, { status: 502 });

  const assets: { id: string; kind: string; name: string; mimeType: string; size: number }[] = [];
  try {
    for (const part of looked.result.parts) {
      if (!mimeAllowed(part.kind, part.mimeType) && !(part.kind === 'guidelines' && part.mimeType === 'application/zip')) continue;
      const asset = await prisma.adAsset.create({
        data: {
          ownerEmail: email,
          kind: part.kind,
          name: part.name.slice(0, 180),
          mimeType: part.mimeType,
          size: part.data.length,
          data: part.data,
          ...link,
        },
        select: { id: true, kind: true, name: true, mimeType: true, size: true },
      });
      assets.push(asset);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not store the brand files.';
    return NextResponse.json({ error: `Could not store the brand files. ${message}`.slice(0, 300) }, { status: 500 });
  }

  const counts = { guidelines: 0, logos: 0, fonts: 0, refs: 0 } as Record<string, number>;
  for (const asset of assets) counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;

  return NextResponse.json({
    brandName: looked.result.brandName,
    product: looked.result.product,
    website: looked.result.website,
    c1: looked.result.c1,
    c2: looked.result.c2,
    c3: looked.result.c3,
    summary: looked.result.summary,
    fontNames: looked.result.fontNames,
    headlineFont: looked.result.headlineFont,
    logoUrl: looked.result.logoUrl,
    pagesRead: looked.result.pagesRead,
    assets,
    counts,
    profileId,
    projectId,
  });
}

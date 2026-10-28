import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getArenaEmailId } from '@/lib/arena-email';
import { cleanFileName, isAssetKind, isId, svgIsUnsafe } from '@/lib/guard';
import { MAX_BYTES, MAX_FILES } from '@/lib/limits';
import { mimeAllowed } from '@/lib/platforms';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 });
  const file = form.get('file');
  const kind = form.get('kind');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (!isAssetKind(kind)) return NextResponse.json({ error: 'Unknown file type.' }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File must be under 8 MB.' }, { status: 400 });
  }
  const mime = file.type !== '' ? file.type : 'application/octet-stream';
  if (!mimeAllowed(kind, mime)) return NextResponse.json({ error: 'That file type is not allowed here.' }, { status: 400 });

  const owned = await prisma.adAsset.count({ where: { ownerEmail: email, projectId: null, profileId: null } });
  if (owned >= MAX_FILES) return NextResponse.json({ error: 'Too many unassigned files.' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (mime === 'image/svg+xml' && svgIsUnsafe(bytes)) {
    return NextResponse.json({ error: 'That SVG is not allowed.' }, { status: 400 });
  }

  const projectId = form.get('projectId');
  const profileId = form.get('profileId');
  let link: { projectId?: string; profileId?: string } = {};
  if (typeof projectId === 'string' && projectId !== '') {
    if (!isId(projectId)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const project = await prisma.adProject.findFirst({ where: { id: projectId, ownerEmail: email }, select: { id: true } });
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    link = { projectId };
  } else if (typeof profileId === 'string' && profileId !== '') {
    if (!isId(profileId)) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    const profile = await prisma.brandProfile.findFirst({ where: { id: profileId, ownerEmail: email }, select: { id: true } });
    if (!profile) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    link = { profileId };
  }

  const asset = await prisma.adAsset.create({
    data: {
      ownerEmail: email,
      kind,
      name: cleanFileName(file.name),
      mimeType: mime,
      size: file.size,
      data: bytes,
      ...link,
    },
    select: { id: true, kind: true, name: true, mimeType: true, size: true },
  });
  return NextResponse.json(asset);
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { cleanFileName, isId } from '@/lib/guard';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const asset = await prisma.adAsset.findFirst({ where: { id, ownerEmail: email } });
  if (!asset) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'none'; script-src 'none'",
      'Content-Disposition': `inline; filename="${cleanFileName(asset.name)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { falConfigError } from '@/lib/fal';
import { isId } from '@/lib/guard';
import { writeAdCopy } from '@/lib/write-copy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Writes two copy options and returns them. Nothing is painted onto an ad until the user approves. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const email = await currentOwnerEmail();
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email } });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const cfg = falConfigError();
  if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
  const written = await writeAdCopy({ project, count: 2, ownerEmail: email });
  if (!written.ok) return NextResponse.json({ error: written.error }, { status: 502 });
  return NextResponse.json({ versions: written.lines });
}

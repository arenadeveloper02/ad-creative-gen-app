import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getArenaEmailId } from '@/lib/arena-email';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const email = await getArenaEmailId();
  if (!email) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const events = await prisma.usageEvent.findMany({
    where: { ownerEmail: email },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const total = events.reduce((sum, event) => sum + event.estimatedUsd, 0);
  return NextResponse.json({
    totalUsd: total,
    count: events.length,
    events: events.map((event) => ({
      id: event.id,
      projectId: event.projectId,
      kind: event.kind,
      provider: event.provider,
      model: event.model,
      estimatedUsd: event.estimatedUsd,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}

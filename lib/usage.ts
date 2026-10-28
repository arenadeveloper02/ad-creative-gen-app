import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const RATES: Record<string, number> = {
  'studio:image': 0.04,
  'fal:image': 0.05,
  'fal:text': 0.01,
};

export function estimateUsd(provider: string, kind: string): number {
  return RATES[`${provider}:${kind}`] ?? 0.04;
}

export async function logUsage(opts: {
  ownerEmail: string;
  projectId?: string | null;
  kind: string;
  provider: string;
  model: string;
  estimatedUsd?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.usageEvent.create({
      data: {
        ownerEmail: opts.ownerEmail,
        projectId: opts.projectId ?? null,
        kind: opts.kind,
        provider: opts.provider,
        model: opts.model,
        estimatedUsd: opts.estimatedUsd ?? estimateUsd(opts.provider, opts.kind),
        meta: opts.meta ? (opts.meta as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    console.error('[usage] failed to log', err instanceof Error ? err.message : err);
  }
}

/**
 * Reports a finished Fal request to Sim so the real Fal price and the 1.5x
 * block cost are written to usage_log. No key is stored in source.
 * A missing env or a failed report never fails the ad.
 */
export async function reportFalUsage(opts: { email: string; endpointId: string; requestId: string }): Promise<void> {
  const url = process.env.ARENA_USAGE_URL?.trim();
  const apiKey = process.env.ARENA_USAGE_API_KEY?.trim();
  if (!url || !apiKey || opts.endpointId.trim() === '' || opts.requestId.trim() === '') return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ email: opts.email, endpointId: opts.endpointId, requestId: opts.requestId }),
      cache: 'no-store',
    });
    if (!res.ok) console.error(`[usage] Arena report failed: HTTP ${res.status}`);
  } catch (err) {
    console.error('[usage] Arena report failed', err instanceof Error ? err.message : err);
  }
}

import type { AdProject } from '@prisma/client';
import { buildLlmInput, LLM_ENDPOINT, llmModel } from '@/lib/fal-models';
import { runFalJob } from '@/lib/fal';
import { isRecord } from '@/lib/json';
import { logUsage, reportFalUsage } from '@/lib/usage';

export interface WrittenLine {
  headline: string;
  sub: string;
  primary: string;
}

const SYSTEM = [
  'You write paid social ad copy.',
  'Return only JSON with this shape: {"versions":[{"headline":"","sub":"","primary":""}]}',
  'headline is under 40 characters. sub is under 90 characters. primary is under 280 characters.',
  'Each version takes a different angle. Do not invent prices, statistics, awards, or customer counts.',
  'Do not include hashtags, emojis, or words the user said to avoid.',
].join(' ');

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function findOutput(value: unknown, depth = 0): string | null {
  if (depth > 5 || !isRecord(value)) return null;
  if (typeof value.output === 'string' && value.output.trim() !== '') return value.output;
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const found = findOutput(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function readVersions(text: string, count: number): WrittenLine[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.versions)) return null;
  const lines: WrittenLine[] = [];
  for (const item of parsed.versions) {
    if (!isRecord(item)) continue;
    const headline = clip(item.headline, 80);
    const sub = clip(item.sub, 160);
    const primary = clip(item.primary, 500);
    if (headline && primary) lines.push({ headline, sub, primary });
  }
  return lines.length >= count ? lines.slice(0, count) : null;
}

function briefText(project: AdProject, count: number, currentHeadline?: string): string {
  const ask = project.copyPrompt.trim() || project.description.trim() || `Write an ad for ${project.product || project.brandName || 'the product'}.`;
  const lines = [
    `Write ${count} version${count === 1 ? '' : 's'} of the ad copy.`,
    `What the copy should say: ${ask}`,
    `Brand: ${project.brandName || 'unspecified'}`,
    `Product: ${project.product || 'unspecified'}`,
    `Goal: ${project.goal}`,
    `Audience: ${project.audience || 'unspecified'}`,
    `Tone: ${project.tone}`,
    `Platform: ${project.platform}, ${project.format}`,
    `Call to action: ${project.cta}`,
  ];
  if (project.avoid.trim()) lines.push(`Avoid: ${project.avoid.trim()}`);
  if (currentHeadline) lines.push(`The current headline is "${currentHeadline}". Write a different one.`);
  return lines.join('\n');
}

/** Asks Gemini, through fal.ai, for the headline, supporting line, and primary text. */
export async function writeAdCopy(opts: {
  project: AdProject;
  count: number;
  currentHeadline?: string;
  ownerEmail: string;
}): Promise<{ ok: true; lines: WrittenLine[] } | { ok: false; error: string }> {
  const run = await runFalJob(LLM_ENDPOINT, buildLlmInput(SYSTEM, briefText(opts.project, opts.count, opts.currentHeadline)), 60000);
  if (!run.ok) return { ok: false, error: run.error ?? 'The copy model failed.' };
  const text = findOutput(run.output);
  const lines = text ? readVersions(text, opts.count) : null;
  if (!lines) return { ok: false, error: 'The copy model returned text that could not be used. Try again.' };

  await logUsage({
    ownerEmail: opts.ownerEmail,
    projectId: opts.project.id,
    kind: 'text',
    provider: 'fal',
    model: llmModel(),
    meta: { endpoint: LLM_ENDPOINT, requestId: run.requestId, count: opts.count },
  });
  if (run.requestId) {
    await reportFalUsage({ email: opts.ownerEmail, endpointId: run.endpointId, requestId: run.requestId });
  }
  return { ok: true, lines };
}

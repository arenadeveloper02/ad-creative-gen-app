import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { currentOwnerEmail } from '@/lib/arena-email';
import { draftVersion, type CopyInput, type VersionDraft } from '@/lib/copy';
import type { WrittenLine } from '@/lib/write-copy';
import { falConfigError } from '@/lib/fal';
import { generateVersionImage } from '@/lib/generate-image';
import { writeAdCopy } from '@/lib/write-copy';
import { cleanText, isId } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { MAX_VERSIONS } from '@/lib/limits';
import { projectInclude, serializeProject, asCopySource } from '@/lib/serialize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const projectWithAssets = {
  versions: { orderBy: { position: 'asc' as const } },
  assets: { select: { id: true, kind: true, mimeType: true } },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const email = await currentOwnerEmail();
  const { id } = await params;
  if (!isId(id)) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const body: unknown = await req.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  const mode = body.mode === 'append' || body.mode === 'rewrite' || body.mode === 'image' || body.mode === 'refresh' ? body.mode : 'replace';

  const project = await prisma.adProject.findFirst({ where: { id, ownerEmail: email }, include: projectWithAssets });
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  const owned = project;

  const input: CopyInput = {
    product: project.product,
    brand: project.brandName,
    goal: project.goal,
    tone: project.tone,
    audience: project.audience,
    description: project.description,
    cta: project.cta,
    copySource: asCopySource(project.copySource),
    headline: project.headline,
    subline: project.subline,
  };

  async function resolveDrafts(count: number, startIndex: number, currentHeadline?: string): Promise<{ ok: true; drafts: VersionDraft[] } | { ok: false; error: string }> {
    if (input.copySource !== 'ai') {
      return { ok: true, drafts: Array.from({ length: count }, (_, index) => draftVersion(input, startIndex + index, owned.format)) };
    }
    const cfg = falConfigError();
    if (cfg) return { ok: false, error: cfg };
    const written = await writeAdCopy({ project: owned, count, currentHeadline, ownerEmail: email });
    if (!written.ok) return written;
    return {
      ok: true,
      drafts: written.lines.map((line, index) => ({
        ...draftVersion(input, startIndex + index, owned.format),
        headline: line.headline,
        sub: line.sub,
        primary: line.primary,
      })),
    };
  }

  if (mode === 'rewrite') {
    if (!isId(body.versionId)) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const version = project.versions.find((item) => item.id === body.versionId);
    if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const resolved = await resolveDrafts(1, version.position + 1, version.headline);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
    const draft = resolved.drafts[0];
    await prisma.adVersion.update({ where: { id: version.id }, data: { headline: draft.headline, sub: draft.sub, primary: draft.primary } });
  } else if (mode === 'image') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    if (!isId(body.versionId)) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const version = project.versions.find((item) => item.id === body.versionId);
    if (!version) return NextResponse.json({ error: 'Version not found.' }, { status: 404 });
    const editPrompt = cleanText(body.editPrompt, 1000);
    if (body.stream === true) {
      return streamGeneration({
        intro: `Updating the picture on Version ${String.fromCharCode(65 + version.position)}.${editPrompt ? `\nChange asked for: ${editPrompt}` : ''}`,
        versions: [version],
        project,
        ownerEmail: email,
        editPrompt,
      });
    }
    const result = await generateVersionImage({ project, version, ownerEmail: email, editPrompt });
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'Image generation failed.' }, { status: 502 });
  } else if (mode === 'refresh') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    const keep = project.versions.filter((item) => item.position < 2);
    if (keep.length === 0) return NextResponse.json({ error: 'Generate the ad before refreshing the images.' }, { status: 400 });
    if (body.stream === true) {
      return streamGeneration({
        intro: 'Redrawing the pictures on Version A and B. The copy, colours, and layout stay as they are.',
        versions: keep,
        project,
        ownerEmail: email,
      });
    }
    const results = await Promise.all(keep.map((version) => generateVersionImage({ project, version, ownerEmail: email })));
    const failed = results.find((item) => !item.ok);
    if (failed && results.every((item) => !item.ok)) {
      return NextResponse.json({ error: failed.error ?? 'Image generation failed.' }, { status: 502 });
    }
  } else if (mode === 'append') {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    const room = MAX_VERSIONS - project.versions.length;
    if (room < 1) {
      return NextResponse.json({ error: `You can keep up to ${MAX_VERSIONS} versions.` }, { status: 400 });
    }
    const asked = typeof body.count === 'number' && Number.isFinite(body.count) ? Math.floor(body.count) : 1;
    if (asked < 1 || asked > room) {
      return NextResponse.json({ error: `Choose between 1 and ${room} more version${room === 1 ? '' : 's'}.` }, { status: 400 });
    }
    const taken = project.versions.map((item) => item.headline).filter((item) => item.trim() !== '');
    const resolved = await resolveDrafts(asked, project.versions.length, taken.length > 0 ? taken.join('; ') : undefined);
    if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
    // Extras match the first render, not the user's later edits to A:
    // brand colours from the brief, the original text placement, every line shown, and A's size, layout, and template.
    // Only the copy and the picture angle change, so the set reads as one campaign.
    const lead = project.versions[0];
    const created = [];
    for (const [index, draft] of resolved.drafts.entries()) {
      created.push(await prisma.adVersion.create({
        data: {
          projectId: project.id,
          position: project.versions.length + index,
          headline: draft.headline,
          sub: draft.sub,
          primary: draft.primary,
          cta: project.cta || draft.cta,
          layout: lead?.layout ?? draft.layout,
          bg: lead?.bg ?? draft.bg,
          size: lead?.size ?? draft.size,
          c1: project.c1,
          c2: project.c2,
          c3: project.c3,
          headlineX: null,
          headlineY: null,
          subX: null,
          subY: null,
          ctaX: null,
          ctaY: null,
          showHeadline: true,
          showSub: true,
          showCta: true,
        },
      }));
    }
    if (body.stream === true) {
      const names = created.map((item) => String.fromCharCode(65 + item.position));
      return streamGeneration({
        intro: [
          `Adding Version ${names.join(', ')} to the same campaign as A and B.`,
          `Same size (${lead?.size ?? 'as A'}), same template, and the brand colours from the first render ${project.c1}, ${project.c2}, ${project.c3}. Only the words and the camera angle change.`,
        ].join('\n'),
        drafts: resolved.drafts,
        startLetter: project.versions.length,
        versions: created,
        project,
        ownerEmail: email,
      });
    }
    const results = await Promise.all(created.map((version) => generateVersionImage({ project, version, ownerEmail: email })));
    const failed = results.find((item) => !item.ok);
    if (failed && results.every((item) => !item.ok)) {
      return NextResponse.json({ error: failed.error ?? 'Image generation failed.' }, { status: 502 });
    }
  } else {
    const cfg = falConfigError();
    if (cfg) return NextResponse.json({ error: cfg }, { status: 500 });
    let drafts: VersionDraft[];
    if (input.copySource === 'ai') {
      const approved = readApprovedCopy(body);
      if (!approved) return NextResponse.json({ error: 'Approve the copy before generating the ad.' }, { status: 400 });
      drafts = approved.map((line, index) => ({
        ...draftVersion(input, index, owned.format),
        headline: line.headline,
        sub: line.sub,
        primary: line.primary,
      }));
    } else {
      const resolved = await resolveDrafts(2, 0);
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 502 });
      drafts = resolved.drafts;
    }
    const created = await prisma.$transaction(async (tx) => {
      await tx.adVersion.deleteMany({ where: { projectId: project.id } });
      const rows = [];
      for (const [position, draft] of drafts.entries()) {
        rows.push(await tx.adVersion.create({ data: { projectId: project.id, position, ...draft, c1: project.c1, c2: project.c2, c3: project.c3 } }));
      }
      await tx.adProject.update({ where: { id: project.id }, data: { step: 3, status: 'generated' } });
      return rows;
    });
    if (body.stream === true) {
      return streamGeneration({
        drafts,
        versions: created,
        project,
        ownerEmail: email,
      });
    }
    const results = await Promise.all(created.map((version) => generateVersionImage({ project, version, ownerEmail: email })));
    const failed = results.find((r) => !r.ok);
    if (failed && results.every((r) => !r.ok)) {
      return NextResponse.json({ error: failed.error ?? 'Image generation failed.' }, { status: 502 });
    }
  }

  const full = await prisma.adProject.findFirst({ where: { id: project.id, ownerEmail: email }, include: projectInclude });
  if (!full) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  return NextResponse.json(serializeProject(full));
}

function readApprovedCopy(body: Record<string, unknown>): WrittenLine[] | null {
  if (!Array.isArray(body.approvedCopy)) return null;
  const lines: WrittenLine[] = [];
  for (const item of body.approvedCopy.slice(0, 2)) {
    if (!isRecord(item)) continue;
    const headline = cleanText(item.headline, 200);
    const sub = cleanText(item.sub, 200);
    const primary = cleanText(item.primary, 4000);
    if (headline && primary) lines.push({ headline, sub, primary });
  }
  return lines.length > 0 ? lines : null;
}

function streamGeneration(opts: {
  /** Full brief walk-through for the first generate; a short line for later runs. */
  intro?: string;
  drafts?: VersionDraft[];
  startLetter?: number;
  versions: { id: string; position: number; layout: string; size: string; c1: string; c2: string; c3: string; imageUrl: string | null }[];
  project: Parameters<typeof generateVersionImage>[0]['project'];
  ownerEmail: string;
  editPrompt?: string;
}): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const emit = (text: string) => send({ type: 'thought', text });
      try {
        const { project, drafts } = opts;
        if (opts.intro) {
          emit(opts.intro);
        } else {
          emit(`Reading the brief for ${project.product || project.brandName || 'this ad'}.`);
          emit([
            `Brand: ${project.brandName || 'not named'}.`,
            `Product: ${project.product || 'not named'}.`,
            `Goal: ${project.goal}.`,
            `Audience: ${project.audience || 'not set'}.`,
            `Tone: ${project.tone}. Visual style: ${project.visualStyle}.`,
            `Platform: ${project.platform}, ${project.format}.`,
          ].join('\n'));
          if (project.description.trim()) emit(`What was asked for:\n${project.description.trim().slice(0, 600)}`);
          if (project.sceneNote.trim()) emit(`Scene the user asked for:\n${project.sceneNote.trim().slice(0, 600)}`);
          if (project.copyPrompt.trim()) emit(`Copy instruction:\n${project.copyPrompt.trim().slice(0, 600)}`);
          emit('The approved copy stays as written. The picture is drawn without those words, then the headline is painted on top.');
        }
        if (drafts) {
          const start = opts.startLetter ?? 0;
          drafts.forEach((draft, index) => {
            const name = String.fromCharCode(65 + start + index);
            emit(`Version ${name} is locked in.\nHeadline: ${draft.headline}\nSupporting line: ${draft.sub || '—'}\nPrimary text: ${draft.primary}`);
          });
        }
        if (!opts.intro) {
          emit(`Applying brand colors ${project.c1}, ${project.c2}, and ${project.c3} on the ${project.platform} · ${project.format} layout.`);
        }
        emit(opts.versions.length === 1 ? 'Nano Banana Pro at 4K is drawing the picture.' : 'Nano Banana Pro at 4K is drawing each version.');
        const results = await Promise.all(opts.versions.map((version) => generateVersionImage({
          project,
          version,
          ownerEmail: opts.ownerEmail,
          editPrompt: opts.editPrompt,
          onThought: emit,
        })));
        const failed = results.find((item) => !item.ok);
        const full = await prisma.adProject.findFirst({ where: { id: project.id, ownerEmail: opts.ownerEmail }, include: projectInclude });
        if (!full) {
          send({ type: 'error', error: 'Project not found.' });
          return;
        }
        if (failed && results.every((item) => !item.ok)) send({ type: 'error', error: failed.error ?? 'Image generation failed.' });
        else emit('The pictures are stored. The ad is ready to review.');
        send({ type: 'project', project: serializeProject(full) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation failed.';
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  }), {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

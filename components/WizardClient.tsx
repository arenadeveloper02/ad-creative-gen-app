'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AgentCrumb from '@/components/AgentCrumb';
import BriefStep, { type BriefPayload } from '@/components/BriefStep';
import GenerateStep from '@/components/GenerateStep';
import PlatformStep, { type PlatformPayload } from '@/components/PlatformStep';
import Stepper from '@/components/Stepper';
import { readJson } from '@/lib/read-response';
import type { ProfileDTO, ProjectDTO, VersionDTO } from '@/lib/types';

interface WizardClientProps {
  initialProject: ProjectDTO | null;
  profiles: ProfileDTO[];
}

function isProject(value: unknown): value is ProjectDTO {
  return typeof value === 'object' && value !== null && 'id' in value && 'versions' in value;
}

function isRecordVersions(value: unknown): { headline: string; sub: string; primary: string }[] | null {
  if (typeof value !== 'object' || value === null || !('versions' in value)) return null;
  const versions = (value as { versions: unknown }).versions;
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const lines: { headline: string; sub: string; primary: string }[] = [];
  for (const item of versions) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as { headline?: unknown; sub?: unknown; primary?: unknown };
    if (typeof row.headline !== 'string' || typeof row.primary !== 'string') return null;
    lines.push({ headline: row.headline, sub: typeof row.sub === 'string' ? row.sub : '', primary: row.primary });
  }
  return lines;
}

function readThoughtEvent(line: string): { type: 'thought'; text: string } | { type: 'error'; error: string } | { type: 'project'; project: ProjectDTO } | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const event = parsed as { type?: unknown; text?: unknown; error?: unknown; project?: unknown };
  if (event.type === 'thought' && typeof event.text === 'string') return { type: 'thought', text: event.text };
  if (event.type === 'error' && typeof event.error === 'string') return { type: 'error', error: event.error };
  if (event.type === 'project' && isProject(event.project)) return { type: 'project', project: event.project };
  return null;
}

export default function WizardClient({ initialProject, profiles: initialProfiles }: WizardClientProps) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDTO | null>(initialProject);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [step, setStep] = useState(initialProject ? Math.min(Math.max(initialProject.step, 1), 3) : 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thoughts, setThoughts] = useState('');
  const saveTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const platformTimer = useRef<number | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const createLock = useRef<Promise<void> | null>(null);
  const applyEpoch = useRef(0);
  const reachedRef = useRef(initialProject ? Math.max(initialProject.step, initialProject.versions.length > 0 ? 3 : 1) : 1);
  const pendingBrief = useRef<BriefPayload | null>(null);
  const pendingPlatform = useRef<PlatformPayload | null>(null);
  const pendingVersion = useRef<VersionDTO | null>(null);

  function furthest(): number {
    const current = projectRef.current;
    const fromProject = current ? Math.max(current.step, current.versions.length > 0 ? 3 : 1) : 1;
    return Math.max(reachedRef.current, fromProject);
  }

  function canGoto(target: number): boolean {
    if (target === 1) return true;
    if (!projectRef.current) return false;
    return target <= furthest();
  }

  async function flushPending(): Promise<void> {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (platformTimer.current) window.clearTimeout(platformTimer.current);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (createLock.current) await createLock.current;
    const current = projectRef.current;
    if (pendingBrief.current) {
      const data = pendingBrief.current;
      pendingBrief.current = null;
      await writeProject(data);
    }
    if (pendingPlatform.current && projectRef.current) {
      const data = pendingPlatform.current;
      pendingPlatform.current = null;
      await writeProject(data);
    }
    if (pendingVersion.current && current) {
      const version = pendingVersion.current;
      pendingVersion.current = null;
      await fetch(`/api/projects/${current.id}/versions/${version.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(version),
      });
    }
  }

  function goto(next: number) {
    if (!canGoto(next)) return;
    void flushPending().then(() => setStep(next));
  }

  async function writeProject(data: object): Promise<ProjectDTO | null> {
    const existing = projectRef.current;
    const ticket = applyEpoch.current;
    const res = await fetch(existing ? `/api/projects/${existing.id}` : '/api/projects', {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const parsed = await readJson(res);
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not save the ad.' : parsed.error);
      return null;
    }
    if (ticket !== applyEpoch.current) return parsed.data;
    projectRef.current = parsed.data;
    setProject(parsed.data);
    if (!existing) router.replace(`/project/${parsed.data.id}`);
    return parsed.data;
  }

  function queueBrief(data: BriefPayload) {
    const meaningful = data.description !== '' || data.brandName !== '' || data.product !== '' || data.assetIds.length > 0;
    pendingBrief.current = meaningful ? data : null;
    if (!meaningful) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const job = writeProject(data).then(() => undefined);
      createLock.current = job;
      void job.finally(() => {
        if (createLock.current === job) createLock.current = null;
      });
    }, 700);
  }

  function queuePlatform(data: PlatformPayload) {
    pendingPlatform.current = data;
    if (!projectRef.current) return;
    if (platformTimer.current) window.clearTimeout(platformTimer.current);
    platformTimer.current = window.setTimeout(() => {
      void writeProject(data);
    }, 700);
  }

  async function saveBrief(data: BriefPayload) {
    setSaving(true);
    setError(null);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (createLock.current) await createLock.current;
    pendingBrief.current = null;
    const saved = await writeProject({ ...data, step: 2 });
    setSaving(false);
    if (saved) {
      reachedRef.current = Math.max(reachedRef.current, 2);
      setStep(2);
    }
  }

  function appendThought(text: string) {
    setThoughts((current) => (current ? `${current}\n\n${text}` : text));
  }

  async function previewCopy(data: PlatformPayload) {
    if (!project) return { ok: false as const, error: 'Save the brief first.' };
    if (platformTimer.current) window.clearTimeout(platformTimer.current);
    pendingPlatform.current = null;
    const saved = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const savedParsed = await readJson(saved);
    if (!savedParsed.ok) return { ok: false as const, error: savedParsed.error };
    if (isProject(savedParsed.data)) {
      projectRef.current = savedParsed.data;
      setProject(savedParsed.data);
    }
    const written = await fetch(`/api/projects/${project.id}/copy`, { method: 'POST' });
    const parsed = await readJson(written);
    if (!parsed.ok) return { ok: false as const, error: parsed.error };
    const versions = isRecordVersions(parsed.data);
    if (!versions) return { ok: false as const, error: 'The copy model returned nothing usable. Try again.' };
    return { ok: true as const, versions };
  }

  async function generate(data: PlatformPayload) {
    if (!project) return;
    if (data.copySource === 'ai' && (!data.approvedCopy || data.approvedCopy.length === 0)) {
      setError('Approve the copy before generating the ad.');
      return;
    }
    if (platformTimer.current) window.clearTimeout(platformTimer.current);
    pendingPlatform.current = null;
    applyEpoch.current += 1;
    setSaving(true);
    setError(null);
    setThoughts('');
    setStep(3);
    appendThought('Saving the platform choices.');
    const saved = await fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const savedParsed = await readJson(saved);
    if (!savedParsed.ok) {
      setSaving(false);
      setError(savedParsed.error);
      setStep(2);
      return;
    }
    appendThought(data.copySource === 'ai' ? 'Platform saved. The approved copy will be used as written.' : 'Platform saved. Using the copy you wrote.');
    const outcome = await streamGenerate({ mode: 'replace', stream: true, approvedCopy: data.approvedCopy });
    setSaving(false);
    if (!outcome.project) {
      setError(outcome.error ?? 'Could not generate the ad.');
      setStep(2);
      return;
    }
    if (outcome.error) setError(outcome.error);
    reachedRef.current = Math.max(reachedRef.current, 3);
    projectRef.current = outcome.project;
    setProject(outcome.project);
  }

  /** Posts to the generate route and reads the NDJSON stream, appending every thought as it arrives. */
  async function streamGenerate(body: Record<string, unknown>): Promise<{ project: ProjectDTO | null; error: string | null }> {
    if (!project) return { project: null, error: 'Save the brief first.' };
    const generated = await fetch(`/api/projects/${project.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const type = generated.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      const parsed = await readJson(generated);
      if (parsed.ok && isProject(parsed.data)) return { project: parsed.data, error: null };
      return { project: null, error: parsed.ok ? 'Could not generate the ad.' : parsed.error };
    }
    const stream = generated.body;
    if (!stream) return { project: null, error: 'Could not generate the ad.' };
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let nextProject: ProjectDTO | null = null;
    let streamError: string | null = null;
    const take = (line: string) => {
      const event = readThoughtEvent(line);
      if (!event) return;
      if (event.type === 'thought') appendThought(event.text);
      if (event.type === 'error') streamError = event.error;
      if (event.type === 'project') nextProject = event.project;
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) take(line);
    }
    take(buffer);
    return { project: nextProject, error: streamError };
  }

  function queuePatch(version: VersionDTO) {
    if (!project) return;
    pendingVersion.current = version;
    setProject({ ...project, versions: project.versions.map((item) => (item.id === version.id ? version : item)) });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void fetch(`/api/projects/${project.id}/versions/${version.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(version),
      });
    }, 400);
  }

  const [busy, setBusy] = useState(false);

  async function mutate(path: string, method: string, body?: unknown) {
    if (!project) return;
    setError(null);
    setBusy(true);
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await readJson(res);
    setBusy(false);
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not update the ad.' : parsed.error);
      return;
    }
    projectRef.current = parsed.data;
    setProject(parsed.data);
  }

  /** Image work after the first generate: extra versions, redraws, and per-image edits all stream their thoughts. */
  async function mutateWithThoughts(body: Record<string, unknown>) {
    if (!project) return;
    setError(null);
    setBusy(true);
    setThoughts('');
    const outcome = await streamGenerate({ ...body, stream: true });
    setBusy(false);
    if (!outcome.project) {
      setError(outcome.error ?? 'Could not update the ad.');
      return;
    }
    if (outcome.error) setError(outcome.error);
    projectRef.current = outcome.project;
    setProject(outcome.project);
  }

  return (
    <>
      <AgentCrumb backHref="/" />
      <Stepper step={step} canGoto={canGoto} onGoto={goto} />
      {step === 1 && (
        <BriefStep project={project} profiles={profiles} saving={saving} error={error} onContinue={(data) => void saveBrief(data)} onDraft={queueBrief} onProfiles={setProfiles} />
      )}
      {step === 2 && project && (
        <PlatformStep project={project} saving={saving} error={error} onBack={() => goto(1)} onGenerate={(data) => void generate(data)} onDraft={queuePlatform} onPreview={previewCopy} />
      )}
      {step === 3 && project && (
        <GenerateStep
          project={project}
          generating={saving}
          busy={busy}
          thoughts={thoughts}
          error={error}
          onBack={() => goto(2)}
          onPatch={queuePatch}
          onRefresh={() => void mutateWithThoughts({ mode: 'refresh' })}
          onAdd={(count) => void mutateWithThoughts({ mode: 'append', count })}
          onRewrite={(id) => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'rewrite', versionId: id })}
          onImage={(id, editPrompt) => void mutateWithThoughts({ mode: 'image', versionId: id, editPrompt })}
        />
      )}
    </>
  );
}

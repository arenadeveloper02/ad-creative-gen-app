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

export default function WizardClient({ initialProject, profiles: initialProfiles }: WizardClientProps) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDTO | null>(initialProject);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [step, setStep] = useState(initialProject ? Math.min(Math.max(initialProject.step, 1), 3) : 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [think, setThink] = useState<{ title: string; detail: string; state: 'wait' | 'run' | 'done' }[]>([]);
  const [bar, setBar] = useState(0);
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

  async function generate(data: PlatformPayload) {
    if (!project) return;
    if (platformTimer.current) window.clearTimeout(platformTimer.current);
    pendingPlatform.current = null;
    applyEpoch.current += 1;
    setSaving(true);
    setError(null);
    setStep(3);
    const steps = [
      { title: 'Reading your brief', detail: `Understanding ${project.product || project.brandName || 'the product'}`, state: 'wait' as const },
      { title: 'Checking platform and audience', detail: data.platform, state: 'wait' as const },
      { title: 'Writing the versions', detail: data.copySource === 'ai' ? 'Gemini is writing the headline and primary text' : 'Using the copy you wrote', state: 'wait' as const },
      { title: 'Rendering images on fal.ai', detail: `${data.imageModel} · one image per version`, state: 'wait' as const },
    ];
    setThink(steps);
    setBar(15);
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
    setThink((current) => current.map((item, index) => ({ ...item, state: index < 2 ? 'done' : index === 2 ? 'run' : 'wait' })));
    setBar(45);
    const tick = window.setTimeout(() => {
      setThink((current) => current.map((item, index) => ({ ...item, state: index < 3 ? 'done' : 'run' })));
      setBar(70);
    }, 1500);
    const generated = await fetch(`/api/projects/${project.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace' }),
    });
    const parsed = await readJson(generated);
    window.clearTimeout(tick);
    setSaving(false);
    setBar(100);
    setThink((current) => current.map((item) => ({ ...item, state: 'done' })));
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not generate the ad.' : parsed.error);
      return;
    }
    reachedRef.current = Math.max(reachedRef.current, 3);
    projectRef.current = parsed.data;
    setProject(parsed.data);
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

  return (
    <>
      <AgentCrumb backHref="/" />
      <Stepper step={step} canGoto={canGoto} onGoto={goto} />
      {step === 1 && (
        <BriefStep project={project} profiles={profiles} saving={saving} error={error} onContinue={(data) => void saveBrief(data)} onDraft={queueBrief} onProfiles={setProfiles} />
      )}
      {step === 2 && project && (
        <PlatformStep project={project} saving={saving} error={error} onBack={() => goto(1)} onGenerate={(data) => void generate(data)} onDraft={queuePlatform} />
      )}
      {step === 3 && project && (
        <GenerateStep
          project={project}
          generating={saving}
          busy={busy}
          think={think}
          bar={bar}
          error={error}
          onBack={() => goto(2)}
          onPatch={queuePatch}
          onRefresh={() => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'refresh' })}
          onRewrite={(id) => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'rewrite', versionId: id })}
          onImage={(id, editPrompt) => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'image', versionId: id, editPrompt })}
        />
      )}
    </>
  );
}

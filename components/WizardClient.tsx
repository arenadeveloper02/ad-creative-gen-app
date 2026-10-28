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

  function canGoto(target: number): boolean {
    if (target === 1) return true;
    if (!project) return false;
    if (target === 2) return project.step >= 2;
    return project.versions.length > 0 || project.step >= 3;
  }

  async function saveBrief(data: BriefPayload) {
    setSaving(true);
    setError(null);
    const res = await fetch(project ? `/api/projects/${project.id}` : '/api/projects', {
      method: project ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const parsed = await readJson(res);
    setSaving(false);
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not save the brief.' : parsed.error);
      return;
    }
    setProject(parsed.data);
    setStep(2);
    if (!project) router.replace(`/project/${parsed.data.id}`);
  }

  async function generate(data: PlatformPayload) {
    if (!project) return;
    setSaving(true);
    setError(null);
    setStep(3);
    const steps = [
      { title: 'Reading your brief', detail: `Understanding ${project.product || project.brandName || 'the product'}`, state: 'wait' as const },
      { title: 'Checking platform and audience', detail: data.platform, state: 'wait' as const },
      { title: 'Writing the versions', detail: 'Two layouts from the saved brief', state: 'wait' as const },
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
    setThink((current) => current.map((item, index) => ({ ...item, state: index < 2 ? 'done' : 'run' })));
    setBar(60);
    const generated = await fetch(`/api/projects/${project.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace' }),
    });
    const parsed = await readJson(generated);
    setSaving(false);
    setBar(100);
    setThink((current) => current.map((item) => ({ ...item, state: 'done' })));
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not generate the ad.' : parsed.error);
      return;
    }
    setProject(parsed.data);
  }

  function queuePatch(version: VersionDTO) {
    if (!project) return;
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

  async function mutate(path: string, method: string, body?: unknown) {
    if (!project) return;
    setError(null);
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await readJson(res);
    if (!parsed.ok || !isProject(parsed.data)) {
      setError(parsed.ok ? 'Could not update the ad.' : parsed.error);
      return;
    }
    setProject(parsed.data);
  }

  return (
    <>
      <AgentCrumb backHref="/" />
      <Stepper step={step} canGoto={canGoto} onGoto={setStep} />
      {step === 1 && (
        <BriefStep project={project} profiles={profiles} saving={saving} error={error} onContinue={(data) => void saveBrief(data)} onProfiles={setProfiles} />
      )}
      {step === 2 && project && (
        <PlatformStep project={project} saving={saving} error={error} onBack={() => setStep(1)} onGenerate={(data) => void generate(data)} />
      )}
      {step === 3 && project && (
        <GenerateStep
          project={project}
          generating={saving}
          think={think}
          bar={bar}
          error={error}
          onBack={() => setStep(2)}
          onPatch={queuePatch}
          onAdd={() => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'append' })}
          onRemove={(id) => void mutate(`/api/projects/${project.id}/versions/${id}`, 'DELETE')}
          onRewrite={(id) => void mutate(`/api/projects/${project.id}/generate`, 'POST', { mode: 'rewrite', versionId: id })}
        />
      )}
    </>
  );
}

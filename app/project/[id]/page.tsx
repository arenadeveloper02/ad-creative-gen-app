import { notFound } from 'next/navigation';
import WizardClient from '@/components/WizardClient';
import { getOwnedProject, listProfiles } from '@/lib/actions';
import { getArenaEmailId } from '@/lib/arena-email';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await getArenaEmailId();
  const [project, profiles] = await Promise.all([getOwnedProject(id, email ?? ''), listProfiles(email ?? '')]);
  if (!project) notFound();
  return (
    <div className="wrap wrap-fill">
      <WizardClient initialProject={project} profiles={profiles} />
    </div>
  );
}

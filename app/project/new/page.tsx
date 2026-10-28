import WizardClient from '@/components/WizardClient';
import { listProfiles } from '@/lib/actions';
import { getArenaEmailId } from '@/lib/arena-email';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const email = await getArenaEmailId();
  const profiles = await listProfiles(email ?? '');
  return (
    <div className="wrap wrap-fill">
      <WizardClient initialProject={null} profiles={profiles} />
    </div>
  );
}

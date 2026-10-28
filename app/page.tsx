import ProjectsHome from '@/components/ProjectsHome';
import { listProjects } from '@/lib/actions';
import { getArenaEmailId } from '@/lib/arena-email';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const email = await getArenaEmailId();
  const projects = await listProjects(email ?? '');
  return (
    <div className="wrap wrap-fill">
      <ProjectsHome projects={projects} />
    </div>
  );
}

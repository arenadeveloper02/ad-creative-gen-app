import ProjectsHome from '@/components/ProjectsHome';
import { listProjects } from '@/lib/actions';
import { currentOwnerEmail } from '@/lib/arena-email';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const email = await currentOwnerEmail();
  const projects = await listProjects(email);
  return (
    <div className="wrap wrap-fill">
      <ProjectsHome projects={projects} />
    </div>
  );
}

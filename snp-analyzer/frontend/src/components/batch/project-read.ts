import { getProject, getProjectSummary } from '@/lib/api';
import { validProject, validProjectSummary } from '@/lib/management-payload';

export async function readProject(id: string) {
  const [project, summary] = await Promise.all([getProject(id), getProjectSummary(id)]);
  if (!validProject(project) || !validProjectSummary(summary) || project.id !== id || summary.project_id !== id) {
    throw new Error('Invalid project response');
  }
  return [project, summary] as const;
}

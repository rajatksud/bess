import { apiRequest } from './client';
import { Project } from './types';

export interface CreateProjectInput {
  name: string;
  customerName?: string;
  location?: string;
}

export function listProjects(): Promise<Project[]> {
  return apiRequest<Project[]>('/projects');
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return apiRequest<Project>('/projects', { method: 'POST', body: input });
}

export function getProject(id: string): Promise<Project> {
  return apiRequest<Project>(`/projects/${id}`);
}

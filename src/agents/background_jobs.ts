// src/agents/background_jobs.ts
// Store en memoria para subagentes lanzados en background.
// Compartido entre spawn_agent (escritura) y el handler de Telegram (lectura).

export type JobStatus = 'running' | 'done' | 'failed';

export interface BackgroundJob {
  id: string;
  label: string;
  task: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  output?: string;
  error?: string;
}

const _jobs = new Map<string, BackgroundJob>();
let _seq = 0;

export function createJob(label: string, task: string): BackgroundJob {
  const id = `bg-${Date.now()}-${++_seq}`;
  const job: BackgroundJob = { id, label, task, status: 'running', startedAt: new Date().toISOString() };
  _jobs.set(id, job);
  return job;
}

export function resolveJob(id: string, output: string): void {
  const j = _jobs.get(id);
  if (j) { j.status = 'done'; j.output = output; j.finishedAt = new Date().toISOString(); }
}

export function failJob(id: string, error: string): void {
  const j = _jobs.get(id);
  if (j) { j.status = 'failed'; j.error = error; j.finishedAt = new Date().toISOString(); }
}

export function getJob(id: string): BackgroundJob | undefined {
  return _jobs.get(id);
}

export function listJobs(): BackgroundJob[] {
  return [..._jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

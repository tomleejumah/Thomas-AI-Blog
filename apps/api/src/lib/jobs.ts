/**
 * Minimal in-memory job store for reporting real generation progress.
 * Keyed by contentId (one active generate job per content item at a time).
 * NOTE: assumes a single API process (see ecosystem.config.cjs — no PM2 cluster
 * mode). If you ever run multiple instances, move this to Redis/DB.
 */

export type JobStatus = "running" | "done" | "error";

export type Job = {
  id: string;
  status: JobStatus;
  pct: number;
  label: string;
  result?: unknown;
  error?: string;
  updatedAt: number;
};

const jobs = new Map<string, Job>();

export function createJob(id: string): Job {
  const job: Job = { id, status: "running", pct: 2, label: "Starting…", updatedAt: Date.now() };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<Pick<Job, "pct" | "label">>) {
  const job = jobs.get(id);
  if (!job || job.status !== "running") return;
  if (patch.pct !== undefined) job.pct = Math.max(job.pct, Math.min(99, patch.pct));
  if (patch.label !== undefined) job.label = patch.label;
  job.updatedAt = Date.now();
}

export function finishJob(id: string, result: unknown) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.pct = 100;
  job.label = "Done";
  job.result = result;
  job.updatedAt = Date.now();
}

export function failJob(id: string, error: string) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.updatedAt = Date.now();
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * DB-backed job store (Prisma `Job` table) — replaces the old in-memory
 * Map so progress survives restarts and works across multiple API
 * instances/processes. Same function names/shape as before; now async.
 */
import { prisma } from "./prisma";

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

const DB_TO_STATUS: Record<string, JobStatus> = {
  QUEUED: "running",
  PROCESSING: "running",
  COMPLETED: "done",
  FAILED: "error",
};

function toJob(row: {
  id: string;
  status: string;
  pct: number;
  label: string | null;
  result: unknown;
  error: string | null;
  updatedAt: Date;
}): Job {
  return {
    id: row.id,
    status: DB_TO_STATUS[row.status] ?? "running",
    pct: row.pct,
    label: row.label ?? "",
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function createJob(id: string, type = "generate", contentId?: string): Promise<Job> {
  const row = await prisma.job.upsert({
    where: { id },
    create: { id, type, contentId, status: "PROCESSING", pct: 2, label: "Starting…" },
    update: { status: "PROCESSING", pct: 2, label: "Starting…", error: null, result: undefined },
  });
  return toJob(row);
}

export async function updateJob(id: string, patch: { pct?: number; label?: string }) {
  try {
    await prisma.job.update({
      where: { id },
      data: {
        ...(patch.pct !== undefined ? { pct: Math.max(0, Math.min(99, patch.pct)) } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
      },
    });
  } catch {
    // job may not exist yet if called out of order — non-fatal
  }
}

export async function finishJob(id: string, result: unknown) {
  await prisma.job.update({
    where: { id },
    data: { status: "COMPLETED", pct: 100, label: "Done", result: result as object },
  });
}

export async function failJob(id: string, error: string) {
  await prisma.job.update({ where: { id }, data: { status: "FAILED", error } });
}

export async function getJob(id: string): Promise<Job | undefined> {
  const row = await prisma.job.findUnique({ where: { id } });
  return row ? toJob(row) : undefined;
}

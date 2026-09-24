/**
 * DB-backed job store (Prisma `Job` table) — replaces the old in-memory
 * Map so progress survives restarts and works across multiple API
 * instances/processes. Same function names/shape as before; now async.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type JobStatus = "running" | "done" | "error";
export type Job = {
  id: string;
  type: string;
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
  type: string;
  status: string;
  pct: number;
  label: string | null;
  result: unknown;
  error: string | null;
  updatedAt: Date;
}): Job {
  return {
    id: row.id,
    type: row.type,
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
    update: {
      type,
      status: "PROCESSING",
      pct: 2,
      label: "Starting…",
      error: null,
      result: Prisma.JsonNull,
    },
  });
  return toJob(row);
}

export async function updateJob(id: string, patch: { pct?: number; label?: string }) {
  try {
    const current = await prisma.job.findUnique({
      where: { id },
      select: { pct: true },
    });
    if (!current) return;
    const nextPct =
      patch.pct === undefined
        ? undefined
        : Math.max(current.pct, Math.max(0, Math.min(99, patch.pct)));
    await prisma.job.update({
      where: { id },
      data: {
        ...(nextPct !== undefined ? { pct: nextPct } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
      },
    });
  } catch {
    // job may not exist yet if called out of order — non-fatal
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return Number(v);
      if (v instanceof Date) return v.toISOString();
      return v;
    })
  ) as Prisma.InputJsonValue;
}

export async function finishJob(id: string, result: unknown) {
  await prisma.job.update({
    where: { id },
    data: { status: "COMPLETED", pct: 100, label: "Done", result: jsonSafe(result) },
  });
}

export async function failJob(id: string, error: string) {
  await prisma.job.update({ where: { id }, data: { status: "FAILED", error } });
}

export async function getJob(id: string): Promise<Job | undefined> {
  const row = await prisma.job.findUnique({ where: { id } });
  return row ? toJob(row) : undefined;
}

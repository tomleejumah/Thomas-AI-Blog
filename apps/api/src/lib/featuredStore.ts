import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../../../../data/featured");

function fileFor(id: string) {
  mkdirSync(DIR, { recursive: true });
  return path.join(DIR, `${id}.png`);
}

export function featuredImagePath(id: string) {
  return fileFor(id);
}

export function hasFeaturedImage(id: string) {
  return existsSync(fileFor(id));
}

export function saveFeaturedImage(id: string, bytes: Buffer) {
  writeFileSync(fileFor(id), bytes);
}

export function readFeaturedImage(id: string): Buffer | null {
  const p = fileFor(id);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

export function copyFeaturedImage(fromId: string, toId: string) {
  const src = fileFor(fromId);
  if (!existsSync(src)) return;
  copyFileSync(src, fileFor(toId));
}

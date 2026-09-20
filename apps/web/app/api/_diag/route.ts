import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Temporary: why does the session not survive between invocations on Vercel? */
export async function GET() {
  const dir = process.env.VERCEL ? "/tmp/darwin" : "data";
  const snap = `${dir}/campaign.json`;
  let write: string;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/_probe`, "ok", "utf8");
    write = "writable";
  } catch (e) {
    write = `FAILED: ${(e as Error).message}`;
  }
  return NextResponse.json({
    vercelEnv: process.env.VERCEL ?? null,
    cwd: process.cwd(),
    dir,
    dirWritable: write,
    snapshotExists: existsSync(snap),
    snapshotBytes: existsSync(snap) ? readFileSync(snap, "utf8").length : 0,
    sessionInMemory: (globalThis as Record<string, unknown>).__darwinSession !== undefined
      ? ((globalThis as Record<string, unknown>).__darwinSession === null ? "null (cached empty)" : "present")
      : "undefined (would restore)",
  });
}

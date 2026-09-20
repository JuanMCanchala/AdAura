import { NextResponse } from "next/server";
import { tick } from "@/lib/engine";
import { persist, requireSession, walletIndexFor } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Advance the market. One tick is one trading day for every living agent. */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const count = Math.min(
    Math.max(Number(searchParams.get("ticks") ?? 1), 1),
    30,
  );

  let session: ReturnType<typeof requireSession>;
  try {
    session = requireSession();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  const reports = [];
  for (let i = 0; i < count; i++) {
    reports.push(await tick(session.campaign, session.market, session.rng));
  }

  // Children born during these ticks need wallet slots reserved, whether or not the chain
  // is wired up, so that a later on-chain proof uses the same address the dashboard shows.
  for (const agent of session.campaign.agents)
    walletIndexFor(session, agent.id);

  persist();

  return NextResponse.json({
    tick: session.campaign.tick,
    generation: session.campaign.generation,
    reports,
  });
}

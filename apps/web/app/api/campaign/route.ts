import { NextResponse } from "next/server";
import { chainConfig, endCampaign, getSession, startCampaign } from "@/lib/store";
import { toView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ campaign: null, chain: chainStatus() });

  return NextResponse.json({ campaign: toView(session.campaign), chain: chainStatus() });
}

function chainStatus() {
  const cfg = chainConfig();
  if (!cfg) return { configured: false as const };
  return {
    configured: true as const,
    chainId: cfg.chain.id,
    name: cfg.chain.name,
    explorer: cfg.chain.blockExplorers?.default.url ?? null,
    treasury: cfg.treasury,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);

  const budgetUsd = Number(body.budgetUsd);
  const populationSize = Number(body.populationSize ?? 6);
  // Only a slice of the budget is committed to generation 0. The rest is the reserve that
  // pays for children and for fresh strategies when selection thins the population out —
  // hand it all over at the start and evolution has nothing left to work with.
  //
  // The per-agent share is small on purpose. Telling a good strategy from an unlucky one
  // takes dozens of sales, so the budget has to cover many agent lifetimes, not six.
  const perAgentUsd = Number(body.perAgentUsd ?? budgetUsd * 0.035);
  const epochCapUsd = Number(body.epochCapUsd ?? perAgentUsd / 12);

  if (!body.product?.name) {
    return NextResponse.json(
      { error: "Name the product you want to sell." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return NextResponse.json(
      { error: "Set a campaign budget above zero." },
      { status: 400 },
    );
  }
  if (perAgentUsd > budgetUsd) {
    return NextResponse.json(
      { error: "Per-agent budget cannot exceed the campaign budget." },
      { status: 400 },
    );
  }

  const session = await startCampaign({
    product: {
      name: String(body.product.name),
      priceUsd: Number(body.product.priceUsd ?? 49),
      margin: Number(body.product.margin ?? 0.6),
      category: String(body.product.category ?? "general"),
      audienceHint: body.product.audienceHint
        ? String(body.product.audienceHint)
        : undefined,
    },
    images: Array.isArray(body.images)
      ? body.images.slice(0, 8).map(String)
      : [],
    landingUrl: body.landingUrl ? String(body.landingUrl) : null,
    budgetUsd,
    perAgentUsd,
    epochCapUsd,
    populationSize,
    seed: body.seed !== undefined ? Number(body.seed) : undefined,
    evolution: {
      ticksPerGeneration: Number(body.ticksPerGeneration ?? 3),
      maxPopulation: Number(
        body.maxPopulation ?? Math.max(8, populationSize + 4),
      ),
      minPopulation: Number(
        body.minPopulation ?? Math.max(3, Math.floor(populationSize / 2)),
      ),
    },
  });

  return NextResponse.json({
    campaignId: session.campaign.id,
    agents: session.campaign.agents.length,
  });
}

export async function DELETE() {
  endCampaign();
  return NextResponse.json({ ok: true });
}

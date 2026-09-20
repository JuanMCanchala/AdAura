import { NextResponse } from "next/server";
import {
  type ProductImage,
  generateCreatives,
  hasApiKey,
  templateCreative,
  voiceFor,
} from "@/lib/creative";
import { persist, requireSession } from "@/lib/store";

export const dynamic = "force-dynamic";
// Six pitches in one call, with a photo attached, comfortably fits inside a minute.
export const maxDuration = 60;

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * Write the sales pitch each living agent would deliver, then hand them to the browser to
 * speak. This is the part of the demo that shows the agents selling rather than describing
 * how they would sell.
 */
export async function POST(request: Request) {
  let session: ReturnType<typeof requireSession>;
  try {
    session = requireSession();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  const { campaign } = session;
  const alive = campaign.agents.filter((a) => a.status === "alive");
  if (alive.length === 0) {
    return NextResponse.json(
      { error: "Every agent is dead, so nobody is left to pitch." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const context = String(body.context ?? campaign.product.audienceHint ?? "");

  let image: ProductImage | null = null;
  if (typeof body.image === "string" && body.image.length > 0) {
    // The browser sends a data: URL; the API wants the payload on its own.
    const match = body.image.match(
      /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s,
    );
    if (!match) {
      return NextResponse.json(
        { error: "The photo must be a PNG, JPEG, GIF or WebP data URL." },
        { status: 400 },
      );
    }
    if (!MEDIA_TYPES.includes(match[1])) {
      return NextResponse.json(
        { error: `Unsupported image type ${match[1]}.` },
        { status: 400 },
      );
    }
    image = {
      mediaType: match[1] as ProductImage["mediaType"],
      data: match[2].replace(/\s/g, ""),
    };
  }

  let creatives: Map<string, ReturnType<typeof templateCreative>>;
  let degraded: string | null = null;
  try {
    creatives = await generateCreatives({
      product: campaign.product,
      context,
      image,
      agents: alive.map((a) => ({
        id: a.id,
        label: a.label,
        genome: a.genome,
      })),
    });
  } catch (e) {
    // A model outage must not leave the stage silent: fall back and say so plainly.
    degraded = (e as Error).message.split("\n")[0];
    creatives = new Map(
      alive.map((a) => [
        a.id,
        templateCreative(a.genome, campaign.product, context),
      ]),
    );
  }

  for (const agent of alive) {
    const creative = creatives.get(agent.id);
    if (creative) agent.creative = creative;
  }
  persist();

  return NextResponse.json({
    usedModel: hasApiKey() && !degraded,
    degraded,
    pitches: alive.map((a) => ({
      agentId: a.id,
      label: a.label,
      strategy: a.genome,
      creative: a.creative,
      voice: voiceFor(a.genome),
    })),
  });
}

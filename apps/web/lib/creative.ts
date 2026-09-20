import Anthropic from "@anthropic-ai/sdk";
import { type Genome, describe } from "./genome";
import type { ProductSpec } from "./market";
import type { Creative, Voice } from "./types";

/**
 * What each agent would actually say to sell the product.
 *
 * The genome is the persona: an aggressive agent selling to teens on TikTok with a scarcity
 * CTA should not sound like an empathetic one writing a newsletter for professionals. That
 * difference is the whole point of the live demo — the population is visibly arguing about
 * how to sell the same thing.
 *
 * An API key is optional. Without one every agent still gets a pitch from the template
 * fallback, so the demo never depends on a network call succeeding on stage.
 */

const MODEL = "claude-opus-5";

/** An image the user uploaded, already normalised to what the API wants. */
export type ProductImage = {
  /** Base64 payload with no data: prefix and no newlines. */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

export type CreativeRequest = {
  product: ProductSpec;
  /** Free text the user wrote about what they are selling. */
  context: string;
  image: ProductImage | null;
  agents: Array<{ id: string; label: string; genome: Genome }>;
};

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Voice settings per genome.
 *
 * Tone drives pitch and CTA drives speed, so two agents that differ in strategy also differ
 * by ear. Without this every agent sounds identical and the demo loses its point.
 */
export function voiceFor(genome: Genome): Voice {
  const pitchByTone: Record<string, number> = {
    humorous: 1.25,
    educational: 0.85,
    aspirational: 1.1,
    urgent: 1.0,
    empathetic: 0.95,
  };
  const rateByCta: Record<string, number> = {
    direct_buy: 1.12,
    learn_more: 0.95,
    discount_code: 1.05,
    free_trial: 1.0,
    scarcity: 1.2,
  };
  return {
    pitch: pitchByTone[genome.tone] ?? 1,
    rate: rateByCta[genome.cta] ?? 1,
    lang: "en-US",
  };
}

/** The deterministic fallback. No API key, no network, still a different pitch per genome. */
export function templateCreative(
  genome: Genome,
  product: ProductSpec,
  context: string,
): Creative {
  const hook: Record<string, string> = {
    humorous: `Look, nobody needs ${product.name}. You just want it. That is allowed.`,
    educational: `Here is what ${product.name} actually does, in one breath.`,
    aspirational: `${product.name} is for the version of you that already decided.`,
    urgent: `${product.name} is moving fast and I am not going to pretend otherwise.`,
    empathetic: `If you have been putting this off, ${product.name} was built for you.`,
  };
  const close: Record<string, string> = {
    direct_buy: "Buy it now.",
    learn_more: "Take one minute and read the rest.",
    discount_code: "Use the code at checkout and it costs less.",
    free_trial: "Try it free. Decide after.",
    scarcity: "When this run is gone, it is gone.",
  };

  const detail = context.trim()
    ? context.trim().split(/(?<=[.!?])\s+/)[0]
    : `It costs $${product.priceUsd}.`;

  const line = hook[genome.tone] ?? `${product.name}.`;
  const cta = close[genome.cta] ?? "Buy it now.";

  return {
    headline: line,
    body: detail,
    cta,
    spoken: `${line} ${detail} ${cta}`,
    source: "template",
  };
}

/**
 * Ask Claude for one pitch per agent, in a single request.
 *
 * One call rather than one per agent: the product photo is the bulk of the input, and
 * sending it six times would cost six times as much and take six times as long, which on
 * stage is the difference between a demo and a wait.
 */
export async function generateCreatives(
  req: CreativeRequest,
): Promise<Map<string, Creative>> {
  const out = new Map<string, Creative>();

  if (!hasApiKey()) {
    for (const a of req.agents)
      out.set(a.id, templateCreative(a.genome, req.product, req.context));
    return out;
  }

  const client = new Anthropic();

  const roster = req.agents
    .map((a) => `${a.label}: ${describe(a.genome)}`)
    .join("\n");

  const instructions = [
    `You are writing the spoken sales pitch for ${req.agents.length} competing AI sales agents.`,
    `They are all selling the same product and each one has a different strategy.`,
    ``,
    `Product: ${req.product.name} — $${req.product.priceUsd}, category ${req.product.category}.`,
    req.context.trim()
      ? `What the seller says about it: ${req.context.trim()}`
      : `The seller gave no extra description.`,
    req.image
      ? `A photo of the product is attached. Use what you can actually see in it — a detail from the image makes the pitch concrete.`
      : `No photo was provided.`,
    ``,
    `The agents and their strategies:`,
    roster,
    ``,
    `For each agent write a pitch that could only come from that strategy. An urgent agent`,
    `selling to teens on TikTok with a scarcity close must not sound like an empathetic one`,
    `writing a newsletter for professionals. Make the difference audible.`,
    ``,
    `"spoken" is read aloud by a speech synthesiser: two or three sentences of plain speech,`,
    `no line breaks, no lists, no markdown, no emoji, no stage directions. Contractions are`,
    `good. Write what a person would say out loud, not what a brochure would print.`,
    `Do not invent facts about the product that the photo and description do not support.`,
  ].join("\n");

  const content: Anthropic.ContentBlockParam[] = [];
  if (req.image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: req.image.mediaType,
        data: req.image.data,
      },
    });
  }
  content.push({ type: "text", text: instructions });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["pitches"],
          properties: {
            pitches: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "headline", "body", "cta", "spoken"],
                properties: {
                  label: { type: "string" },
                  headline: { type: "string" },
                  body: { type: "string" },
                  cta: { type: "string" },
                  spoken: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    messages: [{ role: "user", content }],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No pitches came back.");

  const parsed = JSON.parse(text.text) as {
    pitches: Array<{
      label: string;
      headline: string;
      body: string;
      cta: string;
      spoken: string;
    }>;
  };

  const byLabel = new Map(parsed.pitches.map((p) => [p.label, p]));
  for (const a of req.agents) {
    const p = byLabel.get(a.label);
    // A model that skipped an agent must not leave it mute on stage.
    out.set(
      a.id,
      p
        ? {
            headline: p.headline,
            body: p.body,
            cta: p.cta,
            spoken: p.spoken,
            source: "llm",
          }
        : templateCreative(a.genome, req.product, req.context),
    );
  }
  return out;
}

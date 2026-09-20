import type { Genome } from "../genome";
import type { ProductSpec } from "../market";

/**
 * The contract every pitch provider implements.
 *
 * The rest of the app never learns which model wrote a pitch: `/api/pitch` asks for pitches
 * and gets the same shape back whether they came from Claude, a local Ollama model, or the
 * template fallback. Adding a provider means adding a file here, not touching the route.
 */

/** An image the user uploaded, already normalised to what a model wants. */
export type ProductImage = {
  /** Base64 payload with no data: prefix and no newlines. */
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

export type PitchAgent = { id: string; label: string; genome: Genome };

export type CreativeRequest = {
  product: ProductSpec;
  /** Free text the user wrote about what they are selling. */
  context: string;
  /**
   * The product photo, carried so it can be attached to each publication.
   * It is never sent to a model: the agents decide from the written brief alone.
   */
  image: ProductImage | null;
  /** A stable reference to that photo, stored on each publication as its asset. */
  imageRef?: string | null;
  /** The tick these publications belong to, stamped on each one. */
  tick?: number;
  /** Which campaign each agent was running, keyed by agent id. */
  campaignIds?: Record<string, string | null>;
  agents: PitchAgent[];
};

/** One agent's pitch as a provider returns it, before it becomes a `Creative`. */
export type RawPitch = {
  label: string;
  headline: string;
  body: string;
  cta: string;
  spoken: string;
};

export type Provider = {
  /** Stable id used in logs, the `provider` response field, and env config. */
  readonly name: "anthropic" | "ollama";
  /**
   * A cheap look before committing to a slow call — "is this machine going to manage it?".
   * Returning a string means "do not try", and that string is what the user is told.
   * Optional; a provider without it is always attempted.
   */
  preflight?(req: CreativeRequest): Promise<string | null>;
  /**
   * Whether this provider looks usable without making a network call — an API key present,
   * a base URL configured. A true here is not a promise the call will succeed; it only
   * decides whether we try the model at all or go straight to templates.
   */
  isConfigured(): boolean;
  /** What to tell the user when `isConfigured()` is false. */
  missingConfigHint(): string;
  /** One request for the whole roster. Throws on failure; the caller falls back. */
  generate(req: CreativeRequest): Promise<RawPitch[]>;
};

/**
 * The JSON shape both providers are asked to return.
 *
 * Anthropic takes it as `output_config.format.schema`, Ollama as `format` — the same object
 * serves both, which is why it lives here rather than in either provider.
 */
export const PITCH_SCHEMA = {
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
} as const;

/**
 * The prompt, shared by every provider.
 *
 * Keeping it in one place is what makes the providers comparable: if Claude and a local
 * model are asked different things, a difference in the pitches says nothing about the
 * models. The image is attached separately, in whatever form each API wants.
 */
export function buildPrompt(req: CreativeRequest, roster: string): string {
  return [
    `You are writing the spoken sales pitch for ${req.agents.length} competing AI sales agents.`,
    `They are all selling the same product and each one has a different strategy.`,
    ``,
    `Product: ${req.product.name} — $${req.product.priceUsd}, category ${req.product.category}.`,
    req.context.trim()
      ? `What the seller says about it: ${req.context.trim()}`
      : `The seller gave no extra description.`,
    // Deliberately nothing about the photo. The agents write from the brief; the picture is
    // attached to the finished post afterwards, the way it would be on a real ad.
    req.image
      ? `A product photo will be attached to the published post. Write copy that works alongside a picture — do not describe the picture itself, and do not claim anything about how the product looks.`
      : ``,
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
    ``,
    `Write every field in English. Some multilingual models drift to another language`,
    `partway through a list; the browser reads these aloud with an English voice, so a pitch`,
    `in another language is unusable.`,
    `Return one object per agent, using exactly the labels above.`,
  ].join("\n");
}

/** Parse a provider's JSON reply into pitches, tolerating a model that wrapped it in prose. */
export function parsePitches(text: string): RawPitch[] {
  let raw = text.trim();

  // Smaller local models often fence the JSON or pad it with a sentence either side.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  if (!raw.startsWith("{")) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  }

  let parsed: { pitches?: RawPitch[] };
  try {
    parsed = JSON.parse(raw) as { pitches?: RawPitch[] };
  } catch {
    // A local model that hit its token ceiling leaves the JSON unterminated. Rather than
    // lose every publication to one clipped string, keep the objects that did close — the
    // caller fills any missing agent from the template, so nobody ends up mute.
    const salvaged = salvagePitches(raw);
    if (salvaged.length === 0) throw new Error("The model returned unparseable JSON.");
    return salvaged;
  }
  if (!Array.isArray(parsed.pitches))
    throw new Error("The model did not return a `pitches` array.");
  return parsed.pitches;
}

/** Pull whole `{...}` objects out of a truncated reply, ignoring the unfinished tail. */
function salvagePitches(raw: string): RawPitch[] {
  const out: RawPitch[] = [];
  // Objects that contain a "spoken" field are publications; anything else is scaffolding.
  for (const m of raw.matchAll(/\{[^{}]*"spoken"[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]) as RawPitch;
      if (o.label && o.spoken) out.push(o);
    } catch {
      // A half-written object at the cut point — skip it.
    }
  }
  return out;
}

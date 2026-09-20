import { selectedProvider, selectedProviderName } from "./ai";
import type { CreativeRequest, ProductImage } from "./ai/types";
import type { Genome } from "./genome";
import type { ProductSpec } from "./market";
import { renderCreativeSvg, visualFor } from "./ai/visual";
import type { Creative, Voice } from "./types";

/**
 * What each agent would actually say to sell the product.
 *
 * The genome is the persona: an aggressive agent selling to teens on TikTok with a scarcity
 * CTA should not sound like an empathetic one writing a newsletter for professionals. That
 * difference is the whole point of the live demo — the population is visibly arguing about
 * how to sell the same thing.
 *
 * Which model writes the pitches is a deployment choice (`AI_PROVIDER`), not something this
 * file knows about. What it does own is the guarantee that every agent ends up with a pitch:
 * no provider configured, or a provider that fails, still leaves the stage full.
 */

export type { ProductImage, CreativeRequest };

/** True when the selected provider has what it needs to be worth calling. */
export function hasApiKey(): boolean {
  return selectedProvider().isConfigured();
}

/** Which provider is in play, for the response and for error messages. */
export function providerName(): string {
  return selectedProviderName();
}

export function missingConfigHint(): string {
  return selectedProvider().missingConfigHint();
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

/** The deterministic fallback. No model, no network, still a different pitch per genome. */
export function templateCreative(
  genome: Genome,
  product: ProductSpec,
  context: string,
  imageRef: string | null = null,
  tick = 0,
  adCampaignId: string | null = null,
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

  const concept = visualFor(genome);
  return {
    headline: line,
    body: detail,
    cta,
    spoken: `${line} ${detail} ${cta}`,
    imageRef,
    source: "template",
    tick,
    adCampaignId,
    visual: renderCreativeSvg(concept, line, product.name),
    mood: concept.mood,
  };
}

/**
 * One pitch per living agent, from whichever provider is selected.
 *
 * Throws only on a provider failure — the caller turns that into the `degraded` signal and
 * falls back to templates, so a model outage costs the pitches their sparkle but never the
 * demo itself.
 */
export async function generateCreatives(
  req: CreativeRequest,
): Promise<Map<string, Creative>> {
  const out = new Map<string, Creative>();
  const provider = selectedProvider();
  // The asset every publication carries. Never sent to a model.
  const imageRef = req.imageRef ?? null;
  const tick = req.tick ?? 0;
  const campaignOf = (agentId: string) => req.campaignIds?.[agentId] ?? null;

  if (!provider.isConfigured()) {
    for (const a of req.agents)
      out.set(
        a.id,
        templateCreative(
          a.genome,
          req.product,
          req.context,
          imageRef,
          tick,
          campaignOf(a.id),
        ),
      );
    return out;
  }

  const pitches = await provider.generate(req);
  const byLabel = new Map(pitches.map((p) => [p.label, p]));

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
            imageRef,
            source: "llm",
            tick,
            adCampaignId: campaignOf(a.id),
            visual: renderCreativeSvg(
              visualFor(a.genome),
              p.headline,
              req.product.name,
            ),
            mood: visualFor(a.genome).mood,
          }
        : templateCreative(
            a.genome,
            req.product,
            req.context,
            imageRef,
            tick,
            campaignOf(a.id),
          ),
    );
  }
  return out;
}

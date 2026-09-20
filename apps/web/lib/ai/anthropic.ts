import Anthropic from "@anthropic-ai/sdk";
import { describe } from "../genome";
import {
  type CreativeRequest,
  PITCH_SCHEMA,
  type Provider,
  type RawPitch,
  buildPrompt,
  parsePitches,
} from "./types";

/**
 * Pitches from Claude. This is the path the live demo was built and rehearsed against.
 *
 * One request for the whole roster rather than one per agent: the product photo is the bulk
 * of the input, and sending it six times would cost six times as much and take six times as
 * long, which on stage is the difference between a demo and a wait.
 */

/** Overridable so a different Claude model can be tried without touching code. */
const DEFAULT_MODEL = "claude-opus-5";

export const anthropicProvider: Provider = {
  name: "anthropic",

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  missingConfigHint() {
    return "Set ANTHROPIC_API_KEY in apps/web/.env.local to have Claude read the photo and write the pitches.";
  },

  async generate(req: CreativeRequest): Promise<RawPitch[]> {
    // The SDK reads ANTHROPIC_API_KEY itself; the key never leaves the server.
    const client = new Anthropic();

    const roster = req.agents
      .map((a) => `${a.label}: ${describe(a.genome)}`)
      .join("\n");

    // Text only, deliberately. The photo is an asset attached to the finished post, not an
    // input to the decision — the same contract as the local provider, so switching between
    // them changes the writer and nothing else.
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: buildPrompt(req, roster) },
    ];

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: PITCH_SCHEMA },
      },
      messages: [{ role: "user", content }],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text")
      throw new Error("Claude returned no text block.");

    return parsePitches(text.text);
  },
};

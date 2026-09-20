import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomGenome } from "../genome";
import { mulberry32 } from "../rng";
import { templateCreative } from "../creative";

/**
 * The provider layer's job is to be swappable without the rest of the app noticing.
 * These cover the parts that do not need a model running: selection, config detection,
 * the shared parse, and the promise that a broken provider still leaves the stage full.
 */

const PRODUCT = {
  name: "Aurora Sleep Mask",
  priceUsd: 49,
  margin: 0.62,
  category: "wellness",
};

const saved = { ...process.env };

beforeEach(() => {
  process.env.AI_PROVIDER = undefined;
  process.env.ANTHROPIC_API_KEY = undefined;
  process.env.OLLAMA_MODEL = undefined;
  process.env.OLLAMA_BASE_URL = undefined;
});

afterEach(() => {
  process.env = { ...saved };
});

async function fresh() {
  // The selector reads env at call time, but re-importing keeps each case independent.
  return await import("./index");
}

describe("provider selection", () => {
  it("defaults to anthropic so an existing config keeps working", async () => {
    const { selectedProviderName } = await fresh();
    expect(selectedProviderName()).toBe("anthropic");
  });

  it("selects ollama when asked", async () => {
    process.env.AI_PROVIDER = "ollama";
    const { selectedProviderName } = await fresh();
    expect(selectedProviderName()).toBe("ollama");
  });

  it("is case and whitespace insensitive", async () => {
    process.env.AI_PROVIDER = "  OLLAMA  ";
    const { selectedProviderName } = await fresh();
    expect(selectedProviderName()).toBe("ollama");
  });

  it("falls back to anthropic on a typo instead of taking the demo down", async () => {
    process.env.AI_PROVIDER = "ollmaa";
    const { selectedProviderName } = await fresh();
    expect(selectedProviderName()).toBe("anthropic");
  });
});

describe("configuration detection", () => {
  it("anthropic needs a key", async () => {
    const { anthropicProvider } = await fresh();
    expect(anthropicProvider.isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";
    expect(anthropicProvider.isConfigured()).toBe(true);
  });

  it("ollama needs a model name, since the base URL has a default", async () => {
    const { ollamaProvider } = await fresh();
    expect(ollamaProvider.isConfigured()).toBe(false);
    process.env.OLLAMA_MODEL = "qwen2.5vl";
    expect(ollamaProvider.isConfigured()).toBe(true);
  });

  it("each provider says what is missing", async () => {
    const { anthropicProvider, ollamaProvider } = await fresh();
    expect(anthropicProvider.missingConfigHint()).toMatch(/ANTHROPIC_API_KEY/);
    expect(ollamaProvider.missingConfigHint()).toMatch(/OLLAMA_MODEL/);
  });
});

describe("ollama endpoint configuration", () => {
  it("defaults to localhost and strips a trailing slash", async () => {
    const { ollamaBaseUrl } = await import("./ollama");
    expect(ollamaBaseUrl()).toBe("http://localhost:11434");
    process.env.OLLAMA_BASE_URL = "http://box.local:11434/";
    expect(ollamaBaseUrl()).toBe("http://box.local:11434");
  });
});

describe("parsing a model's reply", () => {
  it("accepts clean JSON", async () => {
    const { parsePitches } = await fresh();
    const out = parsePitches(
      '{"pitches":[{"label":"A01","headline":"h","body":"b","cta":"c","spoken":"s"}]}',
    );
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("A01");
  });

  it("recovers JSON a smaller model wrapped in a code fence", async () => {
    const { parsePitches } = await fresh();
    const out = parsePitches(
      'Sure!\n```json\n{"pitches":[{"label":"A01","headline":"h","body":"b","cta":"c","spoken":"s"}]}\n```',
    );
    expect(out[0].spoken).toBe("s");
  });

  it("recovers JSON padded with prose", async () => {
    const { parsePitches } = await fresh();
    const out = parsePitches(
      'Here you go: {"pitches":[{"label":"A02","headline":"h","body":"b","cta":"c","spoken":"s"}]} Hope that helps!',
    );
    expect(out[0].label).toBe("A02");
  });

  it("salvages whole publications from a reply cut off mid-string", async () => {
    const { parsePitches } = await fresh();
    // What a local model produces when it hits its token ceiling: two complete objects
    // and a third that stops partway through.
    const truncated =
      '{"pitches":[' +
      '{"label":"A01","headline":"h1","body":"b1","cta":"c1","spoken":"s1"},' +
      '{"label":"A02","headline":"h2","body":"b2","cta":"c2","spoken":"s2"},' +
      '{"label":"A03","headline":"h3","body":"b3","cta":"c3","spoken":"s3 unfinis';
    const out = parsePitches(truncated);
    expect(out.map((p) => p.label)).toEqual(["A01", "A02"]);
  });

  it("rejects a reply with no pitches array", async () => {
    const { parsePitches } = await fresh();
    expect(() => parsePitches('{"result":"nope"}')).toThrow(/pitches/);
  });
});

describe("the stage is never left silent", () => {
  it("templates still differ by genome, with no provider configured", () => {
    const rng = mulberry32(7);
    const a = templateCreative(
      { ...randomGenome(rng), tone: "urgent", cta: "scarcity" },
      PRODUCT,
      "Roasted last week.",
    );
    const b = templateCreative(
      { ...randomGenome(rng), tone: "educational", cta: "learn_more" },
      PRODUCT,
      "Roasted last week.",
    );
    expect(a.spoken).not.toBe(b.spoken);
    expect(a.source).toBe("template");
    expect(b.source).toBe("template");
    // Whatever the genome, a pitch always has something to say out loud.
    expect(a.spoken.length).toBeGreaterThan(20);
  });
});

describe("the photo is a publication asset, not model input", () => {
  it("never mentions the image contents in the prompt", async () => {
    const { buildPrompt } = await import("./types");
    const { randomGenome } = await import("../genome");
    const { mulberry32 } = await import("../rng");
    const rng = mulberry32(3);
    const req = {
      product: PRODUCT,
      context: "Roasted last week.",
      image: { data: "DDDD", mediaType: "image/png" as const },
      imageRef: "data:image/png;base64,DDDD",
      agents: [{ id: "a1", label: "A01", genome: randomGenome(rng) }],
    };
    const prompt = buildPrompt(req, "A01: …");

    // The brief is what the agent reasons from.
    expect(prompt).toMatch(/Roasted last week/);
    // The photo is named only as something that will be attached, never described.
    expect(prompt).toMatch(/attached to the published post/);
    expect(prompt).not.toMatch(/what you can actually see/);
    // And the bytes never reach the prompt.
    expect(prompt).not.toMatch(/DDDD/);
  });

  it("attaches the asset to a template publication", async () => {
    const { templateCreative } = await import("../creative");
    const { randomGenome } = await import("../genome");
    const { mulberry32 } = await import("../rng");
    const g = randomGenome(mulberry32(5));
    const withAsset = templateCreative(g, PRODUCT, "ctx", "img://ref");
    expect(withAsset.imageRef).toBe("img://ref");
    // No photo is a publication with no asset, not a failure.
    expect(templateCreative(g, PRODUCT, "ctx").imageRef).toBeNull();
  });
});

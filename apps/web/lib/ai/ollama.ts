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
 * Pitches from a model running on the user's own machine, through Ollama's HTTP API.
 *
 * The model has to be multimodal: the whole point of the feature is that an agent looks at
 * the product photo and says something concrete about it. A text-only model will answer
 * without ever seeing the image and the pitches quietly get worse, so `checkModel()` warns
 * when the configured model has no vision family.
 */

const DEFAULT_BASE_URL = "http://localhost:11434";

/** No default model: a wrong guess silently pulls gigabytes, so the user names it. */
export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL ?? "";
}

export function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

type TagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: { families?: string[]; family?: string };
  }>;
};

export type ModelCheck = {
  reachable: boolean;
  /** Names Ollama reports, for an error message that tells the user what they do have. */
  installed: string[];
  modelPresent: boolean;
  /** False when the model is installed but reports no vision family. */
  multimodal: boolean | null;
  error: string | null;
};

/**
 * Ask Ollama what it has, before trying to generate.
 *
 * Worth the extra round trip: "model not installed" with the exact `ollama pull` command is
 * a fixable message, whereas the raw 404 from /api/chat is not.
 */
export async function checkModel(timeoutMs = 4000): Promise<ModelCheck> {
  const base = ollamaBaseUrl();
  const want = ollamaModel();
  const empty: ModelCheck = {
    reachable: false,
    installed: [],
    modelPresent: false,
    multimodal: null,
    error: null,
  };

  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
      return { ...empty, error: `Ollama answered ${res.status} on /api/tags.` };

    const data = (await res.json()) as TagsResponse;
    const installed = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter(Boolean);

    // Ollama tags are `name:tag`; treat a bare name as matching any tag of it.
    const match = installed.find(
      (n) => n === want || n.split(":")[0] === want.split(":")[0],
    );

    let multimodal: boolean | null = null;
    if (match) {
      const entry = (data.models ?? []).find(
        (m) => (m.name ?? m.model) === match,
      );
      const families = [
        ...(entry?.details?.families ?? []),
        entry?.details?.family ?? "",
      ].map((f) => f.toLowerCase());
      // Vision models carry a projector family (clip / mllama / qwen-vl / …).
      multimodal = families.some((f) =>
        /clip|vision|vl|mllama|projector/.test(f),
      );
    }

    return {
      reachable: true,
      installed,
      modelPresent: Boolean(match),
      multimodal,
      error: null,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return {
      ...empty,
      error: /abort|timeout/i.test(msg)
        ? `Ollama did not answer within ${timeoutMs}ms at ${base}.`
        : `Could not reach Ollama at ${base}: ${msg}`,
    };
  }
}

/**
 * How much memory the machine can actually give a model, in MB.
 *
 * Reads MemAvailable from /proc — the kernel's own estimate of what is obtainable without
 * swapping — rather than "free", which looks alarming on any healthy Linux box. Returns null
 * off Linux, where the guard simply does not apply.
 */
async function availableMemoryMb(): Promise<number | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const m = meminfo.match(/MemAvailable:\s+(\d+) kB/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

/** One non-streaming /api/chat call. Shared by the vision step and the pitch step. */
async function chat(
  prompt: string,
  schema: unknown,
  timeoutMs: number,
  /** Hard ceiling on generated tokens. A small model left unbounded will narrate forever. */
  maxTokens: number,
): Promise<string> {
  const base = ollamaBaseUrl();
  // Text only, always. No `images` key is ever set: the photo is a publication asset, and
  // keeping it out of the prompt is what makes a local model fast enough to be usable.
  const message: Record<string, unknown> = { role: "user", content: prompt };

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: ollamaModel(),
      messages: [message],
      stream: false,
      format: schema,
      options: { temperature: 0.8, num_predict: maxTokens },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Ollama answered ${res.status} on /api/chat${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content;
  if (!text) throw new Error("Ollama returned an empty message.");
  return text;
}

function timeout(): number {
  return Number(process.env.OLLAMA_TIMEOUT_MS ?? 120_000);
}

export const ollamaProvider: Provider = {
  name: "ollama",

  /**
   * Refuse early rather than stall.
   *
   * A local vision model on a machine that is already paging will not finish in any time a
   * person will wait, and a five-minute hang before falling back is worse than an immediate,
   * honest message. The guard is opt-in via OLLAMA_MIN_FREE_MB so a capable box is unaffected.
   */
  async preflight(req: CreativeRequest): Promise<string | null> {
    const check = await checkModel();
    if (!check.reachable)
      return check.error ?? `Ollama is not reachable at ${ollamaBaseUrl()}.`;
    if (!check.modelPresent)
      return (
        `Ollama has no model "${ollamaModel()}". Run \`ollama pull ${ollamaModel()}\`.` +
        (check.installed.length
          ? ` Installed: ${check.installed.join(", ")}.`
          : " No models are installed.")
      );
    // No vision check: the model only ever sees text, so a text-only tag is fine here.
    const minFreeMb = Number(process.env.OLLAMA_MIN_FREE_MB ?? 0);
    if (minFreeMb > 0) {
      const freeMb = await availableMemoryMb();
      if (freeMb !== null && freeMb < minFreeMb)
        return `Only ${freeMb} MB of memory is free; the local model needs about ${minFreeMb} MB. Close some apps or switch AI_PROVIDER to anthropic.`;
    }
    return null;
  },

  isConfigured() {
    // A base URL always has a default, so the only thing the user must supply is the model.
    return Boolean(ollamaModel());
  },

  missingConfigHint() {
    return "Set OLLAMA_MODEL (for example a Qwen3-VL vision tag) in apps/web/.env.local, and make sure `ollama serve` is running.";
  },

  /** Write every publication in one text-only call. */
  async generate(req: CreativeRequest): Promise<RawPitch[]> {
    const blocked = await ollamaProvider.preflight?.(req);
    if (blocked) throw new Error(blocked);

    const roster = req.agents
      .map((a) => `${a.label}: ${describe(a.genome)}`)
      .join("\n");

    const text = await chat(
      buildPrompt(req, roster),
      PITCH_SCHEMA,
      timeout(),
      // Each publication is four fields plus JSON scaffolding; measured runs land near 700
      // tokens for three agents. Budget generously — a cap that truncates mid-string costs
      // the whole response, which is far worse than generating a few tokens too many.
      Math.max(1200, req.agents.length * 400),
    );
    return parsePitches(text);
  },
};

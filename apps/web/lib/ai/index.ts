import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";
import type { Provider } from "./types";

export type ProviderName = Provider["name"];

const PROVIDERS: Record<ProviderName, Provider> = {
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

/**
 * Which provider this deployment uses.
 *
 * Defaults to Anthropic so an existing `.env.local` that only has ANTHROPIC_API_KEY keeps
 * behaving exactly as before — adding Ollama must not change what an unchanged config does.
 * An unrecognised value falls back to Anthropic rather than erroring, because a typo in an
 * env var should not take the demo down.
 */
export function selectedProviderName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  return raw === "ollama" ? "ollama" : "anthropic";
}

export function selectedProvider(): Provider {
  return PROVIDERS[selectedProviderName()];
}

export { anthropicProvider, ollamaProvider };
export type { Provider };
export * from "./types";

import "server-only";
import { DemoProvider } from "./demo";
import { GeminiProvider } from "./gemini";
import type { AiProvider } from "./types";

export * from "./types";

// Picks the AI provider from the environment. To move to another model,
// add a provider class next to gemini.ts and choose it here.
export function getAi(): AiProvider {
  const key = (process.env.GEMINI_API_KEY ?? "").trim();
  if (key) return new GeminiProvider(key, (process.env.GEMINI_MODEL ?? "").trim() || "gemini-2.5-flash");
  return new DemoProvider();
}

export const isAiConfigured = () => (process.env.GEMINI_API_KEY ?? "").trim().length > 0;

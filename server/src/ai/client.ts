import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Two interchangeable AI back-ends:
 * - "anthropic": Claude through the official Anthropic SDK.
 * - "gemini" / "openai": any OpenAI-compatible Chat Completions API through the
 *   official OpenAI SDK. Google Gemini's free tier is the default; Groq,
 *   OpenRouter or a local Ollama work by changing AI_BASE_URL / AI_MODEL.
 * AI is optional at boot: without credentials every AI surface degrades gracefully.
 */
export type AiProvider = "anthropic" | "gemini" | "openai";

const PRESETS: Record<"gemini" | "openai", { baseURL: string; model: string }> = {
  gemini: { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-3.5-flash-lite" },
  openai: { baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export function aiProvider(): AiProvider {
  if (config.AI_PROVIDER) return config.AI_PROVIDER;
  return config.ANTHROPIC_API_KEY || config.ANTHROPIC_AUTH_TOKEN ? "anthropic" : "gemini";
}

export const isAiConfigured = () =>
  aiProvider() === "anthropic" ? !!(config.ANTHROPIC_API_KEY || config.ANTHROPIC_AUTH_TOKEN) : !!config.AI_API_KEY;

export function AI_MODEL(): string {
  const p = aiProvider();
  if (p === "anthropic") return config.ANTHROPIC_MODEL;
  return config.AI_MODEL || PRESETS[p].model;
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

export function getClient(): Anthropic {
  anthropic ??= new Anthropic({ maxRetries: 3 });
  return anthropic;
}

export function getOpenAIClient(): OpenAI {
  const p = aiProvider() === "openai" ? "openai" : "gemini";
  openai ??= new OpenAI({ apiKey: config.AI_API_KEY, baseURL: config.AI_BASE_URL || PRESETS[p].baseURL, maxRetries: 3 });
  return openai;
}

/** Test hooks: inject fake clients. */
export function setClientForTests(fake: Anthropic | null) {
  anthropic = fake;
}
export function setOpenAIClientForTests(fake: OpenAI | null) {
  openai = fake;
}

// Server-side refusal fallback (Claude only): if the primary model declines, the
// API re-runs the request on the model's default fallback inside the same call.
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function describeAiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof OpenAI.AuthenticationError) {
    return "The AI service rejected the API key. Check the key in server/.env.";
  }
  if (e instanceof Anthropic.RateLimitError || e instanceof OpenAI.RateLimitError) {
    return aiProvider() === "anthropic"
      ? "The AI service is rate limited right now. Please retry in a moment."
      : "The free AI quota is used up for now (requests per minute/day). Wait a minute and retry, or switch AI_MODEL.";
  }
  if (e instanceof Anthropic.BadRequestError || e instanceof OpenAI.BadRequestError) return `The AI request was rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError || e instanceof OpenAI.APIConnectionError) {
    return "Could not reach the AI service. Check network connectivity.";
  }
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status}). Please retry.`;
  if (e instanceof OpenAI.APIError) return `AI service error (${e.status}). Please retry.`;
  return "Unexpected error while contacting the AI service.";
}

// Claude API wrapper used by every agent: one call in, parsed JSON out,
// plus token usage and cost so the dashboard can show what each run cost.
// Without an API key the studio runs in demo mode (see agents.mjs).
import Anthropic from "@anthropic-ai/sdk";

// US$ per million tokens (input, output).
const PRICES = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

// Server-side refusal fallback ("default" routing) is offered for these models.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

export class BudgetError extends Error {}

export function createClaude({ apiKey }) {
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  return {
    demo: !client,

    // Returns { data, usage: { inputTokens, outputTokens, costUsd }, model }.
    async json({ model, system, prompt, schema, effort = "medium", maxTokens = 16000 }) {
      if (!client) throw new Error("demo mode has no client");
      const request = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { effort, format: { type: "json_schema", schema } },
      };
      if (FALLBACK_MODELS.has(model)) {
        request.betas = ["server-side-fallback-2026-07-01"];
        request.fallbacks = "default";
      }
      const response = await client.beta.messages.create(request);

      if (response.stop_reason === "refusal") {
        const why = response.stop_details?.explanation || "permintaan ditolak oleh model";
        throw new Error(`Claude menolak: ${why}`);
      }
      if (response.stop_reason === "max_tokens") throw new Error("Jawaban terpotong (max_tokens)");

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const [inPrice, outPrice] = PRICES[response.model] || PRICES[model] || [0, 0];
      const inputTokens = response.usage.input_tokens + (response.usage.cache_read_input_tokens || 0);
      const outputTokens = response.usage.output_tokens;
      return {
        data: JSON.parse(text),
        model: response.model,
        usage: {
          inputTokens,
          outputTokens,
          costUsd: (inputTokens * inPrice + outputTokens * outPrice) / 1e6,
        },
      };
    },
  };
}

// Turns an SDK error into a short message for the run log.
export function describeError(error) {
  if (error instanceof Anthropic.AuthenticationError) return "API key salah atau tidak aktif";
  if (error instanceof Anthropic.RateLimitError) return "Terlalu banyak permintaan, coba lagi sebentar";
  if (error instanceof Anthropic.BadRequestError) return `Permintaan ditolak API: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return "Tidak bisa terhubung ke internet / API";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error?.message || String(error);
}

import OpenAI from "openai";

// Jan AI exposes an OpenAI-compatible endpoint at 127.0.0.1:1337/v1. Override the
// base URL with JAN_AI_BASE_URL for non-default setups. `apiKey` is required by the
// SDK even though Jan ignores it locally.
export const JAN_BASE_URL = process.env.JAN_AI_BASE_URL || "http://127.0.0.1:1337/v1";

// Hard cap on any single request. Belt-and-suspenders: the OpenAI client's own
// `timeout` (below) is the primary bound, but we also pass an AbortSignal to every
// call so a stalled connection / stuck model-load can never hang infinitely even if
// the SDK's internal timer is bypassed or reset mid-request.
export const JAN_TIMEOUT_MS = 15_000;

const ai = new OpenAI({
  baseURL: JAN_BASE_URL,
  apiKey: process.env.JAN_AI_API_KEY || "not-needed-locally",
  timeout: JAN_TIMEOUT_MS, // ⏱️ 15-second safety timeout
});

// Single abort controller per call so the fetch is bounded twice: by the SDK timeout
// *and* by this signal. Created fresh each request (a controller is single-use).
function janSignal() {
  return AbortSignal.timeout(JAN_TIMEOUT_MS);
}

// Model IDs that Jan must have downloaded/activated to respond. If a model isn't
// installed under exactly this name, Jan returns 404/500 rather than hanging — but a
// stale ID here is the most common cause of a "works once, then fails" symptom.
export const JAN_MODELS = {
  heavy: "z-ai/glm-5.2",
  fast: "moonshotai/kimi-k2.5",
} as const;

export async function runHeavyReasoning(prompt: string) {
  const response = await ai.chat.completions.create(
    {
      model: JAN_MODELS.heavy,
      messages: [
        { role: "system", content: "You are an expert POS & Inventory data analyst." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
    },
    { signal: janSignal() },
  );

  return response.choices[0].message.content ?? "No output generated.";
}

export async function runFastTask(prompt: string) {
  const response = await ai.chat.completions.create(
    {
      model: JAN_MODELS.fast, // Matched from your local model list
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    },
    { signal: janSignal() },
  );

  return response.choices[0].message.content ?? "No output generated.";
}
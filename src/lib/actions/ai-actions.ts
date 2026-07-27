"use server";

import { runFastTask, JAN_MODELS, JAN_BASE_URL } from "@/lib/ai";

/**
 * Classifies a Jan AI failure into a user-facing message so the /ai-test page
 * (or any caller) can tell apart the three common failure modes:
 *   - server unreachable (Jan not running / wrong port)
 *   - request timed out (model still loading / stalled connection)
 *   - anything else (most often a 404 for a model not installed under JAN_MODELS.fast)
 */
function explainAiError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");

  // OpenAI SDK surfaces fetch/ECONNREFUSED/ENOTFOUND under "ConnectionError"; node fetch
  // aborts use "The operation was aborted" / "This operation was aborted". SDK timeouts
  // carry the timeout string.
  const lower = msg.toLowerCase();
  if (lower.includes("econnrefused") || lower.includes("econnreset") || lower.includes("enotfound") || lower.includes("fetch failed")) {
    return `Jan AI server unreachable at ${JAN_BASE_URL}. Is the Jan desktop app running and the API server enabled?`;
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborted")) {
    return `Jan AI timed out (model '${JAN_MODELS.fast}' may still be loading into memory). Try again in a few seconds.`;
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("model_not_found")) {
    return `Jan AI returned 404 for model '${JAN_MODELS.fast}'. Ensure that exact model is downloaded and active in Jan, or update JAN_MODELS in src/lib/ai.ts.`;
  }
  return msg || "Failed to connect to local Jan AI server.";
}

export async function generateSalesInsightsAction() {
  try {
    const sampleSales = [
      { id: "1", totalAmount: 150.0, status: "COMPLETED", item: "Espresso Beans (1kg)" },
      { id: "2", totalAmount: 45.5, status: "COMPLETED", item: "Paper Cups (100pack)" },
    ];

    const prompt = `Summarize these POS sales in 1 short sentence: ${JSON.stringify(sampleSales)}`;

    // Using the lighter fast task model
    const summary = await runFastTask(prompt);

    return { success: true, summary };
  } catch (error) {
    console.error("AI Insights Error:", error);
    const explanation = explainAiError(error);
    return { success: false, summary: explanation };
  }
}
"use server";

import { runFastTask } from "@/lib/ai";

/**
 * Local AI is best-effort: the POS/inventory app must keep working when the
 * local Jan AI server isn't running (port 1337). `runFastTask` already bounds
 * the request on both sides (SDK timeout + AbortSignal), so we can never hang
 * waiting on it. If anything goes wrong — server offline, model still loading,
 * 404, timeout — we log once and return a deterministic fallback summary so
 * callers get a usable string instead of an unhandled error, and the UI never
 * blocks waiting for a network response that may never come.
 *
 * `success` reflects whether the *real* model answered. Callers that only need
 * a human-readable summary can treat both branches the same; callers that need
 * to distinguish a genuine model output from the fallback can branch on
 * `success`.
 */
const FALLBACK_SUMMARY =
  "AI insights are unavailable (Jan AI offline at port 1337). Showing a static fallback: today's completed sales cover Espresso Beans and Paper Cups for a combined ~₱195.50.";

export async function generateSalesInsightsAction() {
  try {
    const sampleSales = [
      { id: "1", totalAmount: 150.0, status: "COMPLETED", item: "Espresso Beans (1kg)" },
      { id: "2", totalAmount: 45.5, status: "COMPLETED", item: "Paper Cups (100pack)" },
    ];

    const prompt = `Summarize these POS sales in 1 short sentence: ${JSON.stringify(sampleSales)}`;

    // Light fast-task model. Bounded by the AbortSignal/timeout inside runFastTask,
    // so this await resolves (success or rejection) — it never hangs the main app.
    const summary = await runFastTask(prompt);

    return { success: true, summary };
  } catch (error) {
    // Local Jan AI offline or unreachable — fail gracefully, do not throw up to
    // the caller. Real failures are surfaced in stderr; the UI gets the fallback.
    console.error("AI Insights run failed — falling back:", error);
    return { success: false, summary: FALLBACK_SUMMARY };
  }
}

"use client";

import { useState, useTransition } from "react";
import { generateSalesInsightsAction } from "@/lib/actions/ai-actions";

export default function AITestPage() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const handleTest = () => {
    setResult(null);
    startTransition(async () => {
      const res = await generateSalesInsightsAction();
      if (res.success) {
        setResult(res.summary ?? "Success, but response was empty.");
      } else {
        setResult(`Error: ${res.summary}`);
      }
    });
  };

  return (
    <main className="p-8 max-w-2xl mx-auto font-sans">
      <h1 className="text-2xl font-bold mb-4">Jan AI Integration Test</h1>
      
      <button
        onClick={handleTest}
        disabled={isPending}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Connecting to moonshotai/kimi-k2.5..." : "Run AI Test"}
      </button>

      {result && (
        <div className="mt-6 p-4 border rounded bg-gray-50 dark:bg-zinc-900 whitespace-pre-wrap">
          <p className="font-semibold mb-2 text-sm text-gray-500">AI Response:</p>
          {result}
        </div>
      )}
    </main>
  );
}
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInCashierPin } from "@/app/pos/actions";
import { ShoppingCart, Sparkles } from "lucide-react";
import type { Role } from "@/lib/types";

type LoginUser = { id: string; name: string; role: Role };

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};

export function LoginForm({
  users,
  nextPath,
}: {
  users: LoginUser[];
  nextPath: string | null;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = users.find((u) => u.id === selectedId) ?? null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await signInCashierPin({ userId: selected.id, pin });
    if (res.ok) {
      router.push(res.role === "CASHIER" ? "/pos" : nextPath ?? "/");
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Branding */}
      <div className="flex items-center justify-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm shadow-emerald-600/20">
          <ShoppingCart className="h-6 w-6" />
        </div>
        <div className="leading-tight">
          <p className="text-lg font-semibold tracking-tight text-slate-900">
            JuLs POS
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          1. Who are you?
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2">
          {users.map((u) => {
            const active = u.id === selectedId;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setSelectedId(u.id);
                  setPin("");
                  setError(null);
                }}
                className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition ${
                  active
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-400"
                }`}
              >
                <span className="font-medium">{u.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {ROLE_LABEL[u.role]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          htmlFor="pin-input"
          className="block text-xs font-medium uppercase tracking-wide text-slate-500"
        >
          2. Enter your PIN
        </label>
        <input
          id="pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          disabled={!selected}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder={selected ? "Your 4–6 digit PIN" : "Select your name first"}
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/10 disabled:bg-slate-50"
        />
      </div>

      <button
        type="submit"
        disabled={!selected || pin.length < 4 || busy}
        className="w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Open register"}
      </button>
    </form>
  );
}

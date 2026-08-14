"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInCashierPin } from "@/app/pos/actions";
import { ShoppingCart } from "lucide-react";
import Image from "next/image";
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
    <div className="space-y-6 bg-transparent">
      {/* Branding */}
      <div className="flex flex-col items-center justify-center bg-transparent">
        <Image
          src="/Logo.png"
          alt="JuLs POS SYSTEM"
          width={224}
          height={224}
          priority
          className="w-64 h-64 object-contain mx-auto mb-6 bg-transparent"
        />
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
                    ? "border-blue-600 bg-blue-600 text-white"
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
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600/10 disabled:bg-slate-50"
        />
      </div>

      <button
        type="submit"
        disabled={!selected || pin.length < 4 || busy}
        className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Open register"}
      </button>
    </form>
    </div>
  );
}

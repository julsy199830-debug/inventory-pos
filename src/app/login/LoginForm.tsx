"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInCashierPin } from "@/app/pos/actions";
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
    <div className="space-y-6">
      {/* Branding */}
      <div className="flex flex-col items-center justify-center">
        <Image
          src="/Logo final.png"
          alt="InvPos"
          width={224}
          height={224}
          priority
          className="mx-auto mb-5 h-36 w-36 object-contain"
        />
        <p className="text-center text-sm font-medium text-slate-500">Secure access to your inventory and register</p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
                className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-150 ${
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm hover:shadow"
                    : "border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/50 hover:shadow-sm active:scale-[0.99]"
                }`}
              >
                <span className="font-medium">{u.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    active ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-600"
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
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-100"
        />
      </div>

      <button
        type="submit"
        disabled={!selected || pin.length < 4 || busy}
        className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-700 hover:shadow active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Open register"}
      </button>
    </form>
    </div>
  );
}

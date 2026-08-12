import { prisma } from "@/lib/db";
import { asRole } from "@/lib/types";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — JuLs POS" };

/** Open route: tap your name + enter PIN to open the register. */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
  const nextPath = Array.isArray(next) ? next[0] : next;

  const users = (
    await prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    })
  ).map((u) => ({ ...u, role: asRole(u.role) }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">JuLs POS</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tap your name, then enter your PIN to open the register.
        </p>
        <LoginForm users={users} nextPath={nextPath ?? null} />
      </div>
    </div>
  );
}

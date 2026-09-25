import { prisma } from "@/lib/db";
import { asRole } from "@/lib/types";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — InvPos" };

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-8">
        <LoginForm users={users} nextPath={nextPath ?? null} />
      </div>
    </div>
  );
}

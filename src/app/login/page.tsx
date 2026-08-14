import { prisma } from "@/lib/db";
import { asRole } from "@/lib/types";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — JuLs POS SYSTEM" };

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
      <div className="w-full max-w-md bg-transparent">
        <LoginForm users={users} nextPath={nextPath ?? null} />
      </div>
    </div>
  );
}

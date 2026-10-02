import { prisma } from "@/lib/db";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — InvPos" };

/**
 * Open route: tap your name + enter PIN to open the register.
 *
 * This page is UNAUTHENTICATED, so everything it renders is public to anyone who
 * can reach the app — including the RSC payload the client hydrates from. It
 * therefore selects ONLY the display names the picker needs.
 *
 * It previously also selected each user's `User.id` and `role`, which made a
 * public page a directory of session identifiers: the `pos-cashier` cookie held a
 * bare id with no signature, so reading a known ADMIN id here was enough to forge
 * a full admin session. The id is no longer published, the cookie is signed
 * (`src/lib/session-token.ts`), and sign-in re-resolves the chosen name
 * server-side (`signInStaffPin`). Do not add fields here that the picker does not
 * display.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { next } = await searchParams;
  const nextPath = Array.isArray(next) ? next[0] : next;

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    // Names only — see the note above. The picker renders nothing else, and the
    // sign-in action looks the account up by this exact name.
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-8">
        <LoginForm users={users} nextPath={nextPath ?? null} />
      </div>
    </div>
  );
}

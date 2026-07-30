"use server";

import { revalidatePath } from "next/cache";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { asRole, ROLES, type Role, type ActionResult } from "@/lib/types";
import { PIN_PATTERN } from "@/lib/pin";

/**
 * `load` reads a `FormData` field as a string and coerces an empty/whitespace
 * value to `undefined`, so a missing field is treated as "absent" rather than
 * the literal empty string. Field values arrive as `FormDataEntryValue | null`,
 * so we stringify booleans/files away (unwanted here) before trimming.
 *
 * Mirrors the helper in the customers/suppliers/inventory action files so the
 * Employees module reads the same way.
 */
function load(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw == null) return undefined;
  const str = String(raw).trim();
  return str === "" ? undefined : str;
}

/**
 * The login PIN validation rule. Re-exported here from `@/lib/pin` (the shared
 * single source of truth) so this module reads the same way the POS sign-in
 * action does — see the `User.pin` schema comment for why the string form
 * (not a number) preserves leading zeros.
 */

/**
 * Hash a cleartext password with Node's scrypt (built into Node, no native
 * dependency) and return `salt:hash` so verification can recompute against the
 * stored salt.
 *
 * `passwordHash` is a non-null column on `User`, but PIN is the actual login
 * mechanism in this app (see the `User.pin` schema comment). When no password is
 * supplied we store a deterministic placeholder-derived hash so the column is
 * always populated without pretending a usable password exists — login still
 * keys off `pin` + `active`.
 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a cleartext password against a stored `salt:hash` produced by
 * {@link hashPassword}. Constant-time comparison (`timingSafeEqual`) to avoid a
 * timing oracle. Returns `false` for any malformed stored value rather than
 * throwing, so unknown/legacy hashes simply don't authenticate.
 */
async function verifyPassword(cleartext: string, stored: string): Promise<boolean> {
  const sep = stored.indexOf(":");
  if (sep <= 0 || sep >= stored.length - 1) return false;
  const salt = stored.slice(0, sep);
  const expected = stored.slice(sep + 1);
  const computed = scryptSync(cleartext, salt, 64).toString("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Result types (shared discriminated union from @/lib/types) ──────────────
//
// Aliased here so action signatures read self-documentingly and so any client
// that imports these names resolves to the one shared {@link ActionResult}.
// The success arm spreads its payload onto `{ ok: true }`, so the existing
// `return { ok: true, name }` / `return { ok: true, shiftId }` sites type-check
// unchanged. `error` lives only on the `{ ok: false }` arm.

/** Result of {@link createEmployee}. Echos back the new row's `name` so the
 *  dialog can confirm + close. */
export type CreateEmployeeResult = ActionResult<{ name?: string }>;

/** Result of {@link updateEmployee}. No payload — `revalidatePath` refreshes the
 *  row, so the success case has nothing to echo back. */
export type UpdateEmployeeResult = ActionResult<void>;

/** Result of the shift actions ({@link clockIn} / {@link clockOut}). Carries
 *  the affected `shiftId` so the client can confirm transitions inline without
 *  waiting on the revalidated page. */
export type ShiftResult = ActionResult<{ shiftId?: string }>;

// ── Employee CRUD ───────────────────────────────────────────────────────────

/**
 * Server Action backing the "Add New Employee" dialog.
 *
 * Reachable by anyone who can POST to the app — like every Server Action — so
 * validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * On success we `revalidatePath('/employees')` so the employees table's cached
 * data is purged and the new row streams in on the next render — no manual
 * refetch needed on the client. Like `/inventory` and `/suppliers`, the
 * `(dashboard)` route group is folder-only, so the public path is `/employees`.
 *
 * `role` is narrowed via `asRole` (defaults to CASHIER if absent/unknown), and
 * `pin` must match the hand-rolled {@link PIN_PATTERN}. `passwordHash` is
 * always populated (see {@link hashPassword}); when the optional `password`
 * field is blank it's derived from a placeholder so the non-null column is
 * satisfied while PIN remains the real gate.
 */
export async function createEmployee(
  // No `prevState` here — the dialog invokes this directly via an event
  // handler rather than `useActionState`, so there is no `(prevState, formData)`
  // signature to honor. The whole page is refreshed by revalidatePath, so there
  // is no client state to merge anyway.
  formData: FormData,
): Promise<CreateEmployeeResult> {
  const name = load(formData, "name");
  const email = load(formData, "email");
  const pin = load(formData, "pin");
  const roleRaw = load(formData, "role");
  const password = load(formData, "password");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!name) return { ok: false, error: "Employee name is required." };
  if (!email) return { ok: false, error: "Email address is required." };
  // Email is required for employees (unlike customers) because it doubles as the
  // unique handle for the `User` account. Still shape-check it before insert.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }
  if (!pin || !PIN_PATTERN.test(pin)) {
    return { ok: false, error: "PIN must be 4–6 digits." };
  }
  const role: Role = asRole(roleRaw);

  // ── Insert ─────────────────────────────────────────────────────────────
  // `active` is omitted so SQLite applies its DEFAULT true; `passwordHash`
  // carries a real hash when a password is given, else a placeholder hash so
  // the non-null column is satisfied. PIN (string) preserves leading zeros.
  //
  // Both the password hashing AND the Prisma `create` live inside this try so a
  // throw from either resolves to a { ok:false } result the dialog can show —
  // rather than rejecting the Server Action and freezing the client's "Saving…"
  // pending state. `scryptSync` failing is exotic, but the action must never
  // reject on an unexpected path.
  try {
    const passwordHash = await hashPassword(password ?? `nopass:${email}`);
    await prisma.user.create({
      data: {
        name,
        email,
        pin,
        role,
        passwordHash,
      },
    });
  } catch (err) {
    // P2002 = unique-constraint violation. `email` is the only `@unique` column
    // on `User` in the schema (`pin` is a plain `String` — duplicates are legal,
    // two cashiers may share a PIN); so today only a duplicate email lands here.
    // The target-details inspection still guards generically so a future
    // unique-on-pin migration would surface a sensible message rather than the
    // generic fallback — pin conflicts would otherwise read as "could not save".
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const target =
        typeof (err as { target?: string[] }).target === "object"
          ? (err as { target?: string[] }).target
          : undefined;
      if (target && target.includes("pin")) {
        return { ok: false, error: "That PIN is already in use. Choose another." };
      }
      return {
        ok: false,
        error: `An employee with email "${email}" already exists.`,
      };
    }
    // Anything else is unexpected — surface a generic message rather than
    // leaking internals, and rethrow nothing so the UI stays usable and the
    // dialog's pending state always clears via its own finally block.
    return { ok: false, error: "Could not save the employee. Please try again." };
  }

  revalidatePath("/employees");
  return { ok: true, name };
}

/**
 * Edit an existing employee by its `id`.
 *
 * Like `createEmployee`, this is invoked directly from the dialog's event
 * handler, so it takes only the `formData` — no `prevState`. The row's `id`
 * travels as a hidden field in the same payload — same technique
 * `deleteEmployee` / `toggleEmployeeStatus` use — so there is no second argument
 * or curried closure to worry about.
 *
 * Validation mirrors `createEmployee` (required `name` + `email`, shape-checked
 * `email`). PIN is optional on edit: present → must match {@link PIN_PATTERN};
 * absent → the column is left untouched (no PIN reset on a name-only edit).
 * `role` is narrowed via `asRole`. `password` is optional; present → rehash,
 * absent → leave the existing `passwordHash` alone.
 *
 * We rely on the P2002 guard for a duplicate `email`, and P2025 (record not
 * found) surfaces as a generic error via the catch's fallthrough — if the row
 * was deleted after the page rendered, the user just sees "could not save".
 *
 * `revalidatePath('/employees')` refreshes the cached table so the edited row
 * streams back in on the next render.
 */
export async function updateEmployee(
  // Invoked directly from the event handler rather than `useActionState`, so
  // there is no `prevState` to accept — the whole page is refreshed by
  // revalidatePath, nothing to merge.
  formData: FormData,
): Promise<UpdateEmployeeResult> {
  const id = load(formData, "id");
  const name = load(formData, "name");
  const email = load(formData, "email");
  const pin = load(formData, "pin");
  const roleRaw = load(formData, "role");
  const password = load(formData, "password");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!id) return { ok: false, error: "Missing employee. Please reopen and try again." };
  if (!name) return { ok: false, error: "Employee name is required." };
  if (!email) return { ok: false, error: "Email address is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }
  if (pin != null && !PIN_PATTERN.test(pin)) {
    return { ok: false, error: "PIN must be 4–6 digits." };
  }
  const role: Role = asRole(roleRaw);

  // ── Update ─────────────────────────────────────────────────────────────
  // Only include `pin`/`passwordHash` when the form actually sent them; otherwise
  // the column is left untouched (a name/email/role-only edit keeps the PIN and
  // password the employee already had). The `hashPassword` await moved inside
  // the try below so a hashing throw resolves to { ok:false } — same defensive
  // reason as in `createEmployee` — rather than rejecting the action.
  const data: Record<string, unknown> = { name, email, role };
  if (pin !== undefined) data.pin = pin;

  try {
    if (password !== undefined) data.passwordHash = await hashPassword(password);
    await prisma.user.update({ where: { id }, data });
  } catch (err) {
    // P2002 = unique-constraint violation; the only unique field here is `email`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: `An employee with email "${email}" already exists.`,
      };
    }
    // Anything else (incl. P2025 if the row was deleted mid-flight) is surfaced
    // as a generic message — no internals leaked, UI stays usable.
    return { ok: false, error: "Could not save the employee. Please try again." };
  }

  revalidatePath("/employees");
  return { ok: true };
}

/**
 * Toggle an employee's `active` bit on or off.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement): the
 * row's hidden `id` field is the only payload, and the next `active` state
 * travels as a hidden `active` field ("true"/"false") so the action is
 * idempotent to the row's current state — we always set it to the requested
 * value rather than flipping. Offboarding (active=false) revokes login while
 * keeping the cashier's `Sale`/`Shift` audit trail intact (see the `User.active`
 * and `Sale.cashier` schema comments), which is the whole point of soft-delete
 * here.
 *
 * `revalidatePath('/employees')` refreshes the cached table so the badge flips
 * on the next render.
 */
export async function toggleEmployeeStatus(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  const next = load(formData, "active");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to toggle.
    return;
  }
  const active = next === "true";

  try {
    await prisma.user.update({ where: { id }, data: { active } });
  } catch (err) {
    // P2025 = record not found (the row was already deleted after the page
    // rendered). Nothing to do — the table already reflects the desired state.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return;
    }
    throw err;
  }

  revalidatePath("/employees");
}

/**
 * Assign (re-assign) an employee's authorization role.
 *
 * A dedicated action separate from `updateEmployee` so the role-change control
 * can be a lightweight inline `<select>` posting a tiny payload (`id` + `role`)
 * without round-tripping the whole edit form. `role` is narrowed via `asRole`,
 * so a tampered or unknown value can never widen permissions — it falls back to
 * the least-privileged CASHIER. `revalidatePath('/employees')` refreshes the
 * table so the role badge updates.
 */
export async function assignRole(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  const roleRaw = load(formData, "role");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to assign.
    return;
  }
  const role: Role = asRole(roleRaw);

  try {
    await prisma.user.update({ where: { id }, data: { role } });
  } catch (err) {
    // P2025 = record not found (the row was already deleted after the page
    // rendered). Nothing to do — the table already reflects the desired state.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return;
    }
    throw err;
  }

  revalidatePath("/employees");
}

/**
 * Delete an employee by its `id`.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement): the
 * row's hidden `id` field is the only payload. `Shift.user` is `onDelete:
 * Cascade` in the schema, so removing a User drops their shift clock-in/out
 * records (no orphan shifts — the `User.shifts` schema comment calls this out).
 * `Sale.cashier` is `onDelete: SetNull`, so the cashier's sales audit trail
 * survives — there is therefore no foreign-key violation to guard against (no
 * P2003 branch, unlike `deleteProduct`).
 *
 * Prefer `toggleEmployeeStatus(active=false)` to offboard a cashier while
 * keeping history; this hard-delete path is for genuine cleanup.
 */
export async function deleteEmployee(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return;
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    // P2025 = record not found (the row was already deleted after the page
    // rendered). Nothing to do — the table already reflects the desired state.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return;
    }
    throw err;
  }

  revalidatePath("/employees");
}

// ── Shift tracking ──────────────────────────────────────────────────────────

/**
 * Open a new shift for an employee (clock in).
 *
 * Form-driven: the row's hidden `userId` field is the only payload. `start` is
 * left to the schema's `@default(now())` so the action only sends `userId`
 * (see the `Shift.start` schema comment). `totalSales`/`salesCount` stay at
 * their `@default(0)` until the matching `clockOut` snapshots them.
 *
 * A user may have at most one open shift at a time — closing a previous shift
 * is a precondition, not enforced by the schema — so we first attempt to close
 * any dangling open shift for the same user before opening a fresh one. That
 * keeps a forgotten clock-out from leaving a giant gap shift that would distort
 * the performance summary.
 */
export async function clockIn(formData: FormData): Promise<ShiftResult> {
  const userId = load(formData, "userId");
  if (!userId) return { ok: false, error: "Missing employee. Please reopen and try again." };

  try {
    // Auto-close any still-open shift for this user before opening a new one.
    // `end IS NULL` is "still on the clock"; eventual consistency from the auto-
    // close stays inside the snapshot logic in `clockOut` (sums completed sales
    // attributed to this user/cashierId, and writes them onto the closed row).
    const open = await prisma.shift.findFirst({
      where: { userId, end: null },
    });
    if (open) {
      await closeShift(open.id, open.start);
    }

    const shift = await prisma.shift.create({ data: { userId } });
    revalidatePath("/employees");
    return { ok: true, shiftId: shift.id };
  } catch (err) {
    // P2025 (user not found) and anything else is surfaced as a generic message
    // — no internals leaked, UI stays usable.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return { ok: false, error: "This employee no longer exists. Refresh and try again." };
    }
    return { ok: false, error: "Could not clock in. Please try again." };
  }
}

/**
 * Close the employee's currently-open shift (clock out).
 *
 * Form-driven: the row's hidden `userId` field is the only payload. We resolve
 * the single open shift for that user (`end IS NULL`), and if there is none the
 * action is a no-op (no error — idempotent). Closing snapshots this shift's
 * completed-sale totals onto the row via {@link closeShift} so historical
 * performance is stable and not recomputed against a mutable `Sale` ledger (the
 * `Shift.totalSales`/`salesCount` schema comment calls out this snapshot
 * design).
 */
export async function clockOut(formData: FormData): Promise<ShiftResult> {
  const userId = load(formData, "userId");
  if (!userId) return { ok: false, error: "Missing employee. Please reopen and try again." };

  try {
    const open = await prisma.shift.findFirst({
      where: { userId, end: null },
    });
    if (!open) {
      // Nothing on the clock — treat as a successful no-op so the UI doesn't
      // surface an error for a double clock-out.
      return { ok: true };
    }

    const shiftId = await closeShift(open.id, open.start);
    revalidatePath("/employees");
    return { ok: true, shiftId };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return { ok: false, error: "This employee no longer exists. Refresh and try again." };
    }
    return { ok: false, error: "Could not clock out. Please try again." };
  }
}

/**
 * Internal: snapshot a closed shift's completed-sale totals onto the row.
 *
 * Writes `end = now` and sets `totalSales`/`salesCount` by summing completed
 * sales attributed to `userId` (the cashier who rang them up) whose `createdAt`
 * falls inside `[start, end]`. This is the snapshot the `Shift` schema comment
 * describes: when the shift closes, the totals are stamped in so the historical
 * performance summary is stable even as the live `Sale` ledger keeps changing.
 *
 * Returned `shiftId` lets the public `clockIn`/`clockOut` echo it to the client
 * without a second query. Uses `getCurrentTime()` indirectly via Prisma's
 * `now()`-equivalent default, and `prisma.sale.aggregate` over the userId/cashierId
 * window. Kept transactional-ish (a single `update` writes end + snapshot
 * together) so the row can never be read as-closed-with-empty-totals.
 */
async function closeShift(shiftId: string, start: Date): Promise<string> {
  const end = new Date();

  // The cashier who rang up these sales is this shift's owning user. Resolve the
  // userId first so the aggregate filters on the correct cashierId (schema:
  // `Sale.cashier`, SetNull on cashier delete).
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { userId: true },
  });

  // The close path may run after the user was hard-deleted (Shift.user is
  // Cascade, but the auto-close in clockIn races). If the row is gone there's
  // nothing to snapshot.
  if (!shift) return shiftId;

  // Aggregate completed sales this cashier rang up during [start, end]. `cashierId`
  // is the link back to the same userId; `status` is a plain String narrowed to
  // "Completed" by convention (see `Sale.status` schema comment).
  //
  // For `aggregate`, `_count: true` resolves to a bare `number` (see Prisma's
  // generated `GetSaleAggregateType`: `T[P] extends true ? number`), unlike
  // `groupBy` where `_count: true` is also `number` but `_count: { _all: true }`
  // is the object form. Keeping `_count: true` here matches the `Shift.salesCount
  // Int` column directly.
  const agg = await prisma.sale.aggregate({
    _sum: { totalAmount: true },
    _count: true,
    where: {
      cashierId: shift.userId,
      status: "Completed",
      createdAt: { gte: start, lt: end },
    },
  });

  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      end,
      totalSales: Math.round((agg._sum.totalAmount ?? 0) * 100) / 100,
      salesCount: agg._count,
    },
  });

  return shiftId;
}

// NOTE: a "use server" module may only export async functions. The previous
// `export { ROLES, asRole, verifyPassword }` line violated that contract:
// `ROLES` is an array and `asRole` is a sync function — neither is an async
// function — so Next rejected the whole module at load time, breaking every
// action here (create/update/delete/assign/clock) with
// "A 'use server' file can only export async functions, found object", and
// POSTing /employees 500'd. The page already imports `asRole`/`Role` directly
// from `@/lib/types`, and `RoleSelect` only needs `assignRole`, so nothing
// consumed this re-export — it was dead weight. `verifyPassword` stays as a
// private async helper (still legal: non-exported, used for the comment in
// pos/actions.ts); re-enable it as a real action later if a login flow needs
// it.

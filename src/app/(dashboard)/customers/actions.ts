"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

/**
 * `load` reads a `FormData` field as a string and coerces an empty/whitespace
 * value to `undefined`, so a missing field is treated as "absent" rather than
 * the literal empty string. Field values arrive as `FormDataEntryValue | null`,
 * so we stringify booleans/files away (unwanted here) before trimming.
 */
function load(formData: FormData, key: string): string | undefined {
  const raw = formData.get(key);
  if (raw == null) return undefined;
  const str = String(raw).trim();
  return str === "" ? undefined : str;
}

/** Result shape returned to the client so the dialog can react without an
 *  exception bubbling into React's nearest error boundary. */
export type CreateCustomerResult = {
  ok: boolean;
  /** The first validation/server error to surface inline. */
  error?: string;
  /** The name of the row we created, so the client can confirm + close. */
  name?: string;
};

/** Result shape for `updateCustomer`. Mirrors `CreateCustomerResult` — the
 *  success case has nothing to echo back (the page revalidates), so no `name`
 *  field is needed here. */
export type UpdateCustomerResult = {
  ok: boolean;
  /** The first validation/server error to surface inline. */
  error?: string;
};

/**
 * Parse the optional `loyaltyPoints` field from the form.
 *
 * The Edit dialog renders it as a number input; the Add dialog omits it
 * entirely so new customers always start at the schema's `@default(0)`. We
 * coerce an empty/missing field to `undefined` (leave the column alone on
 * update) and reject non-numeric garbage rather than silently storing 0 — a
 * staff typo like "1a" shouldn't reset a customer's balance.
 *
 * Negative balances are rejected up front: loyalty points are an accrual, not
 * a ledger that can dip below zero here.
 */
function parseLoyaltyPoints(
  formData: FormData,
): { value: number | undefined; error?: string } {
  const raw = load(formData, "loyaltyPoints");
  if (raw == null) return { value: undefined };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { value: undefined, error: "Loyalty points must be a whole number." };
  }
  if (n < 0) {
    return { value: undefined, error: "Loyalty points cannot be negative." };
  }
  return { value: n };
}

/**
 * Server Action backing the "Add New Customer" dialog.
 *
 * Reachable by anyone who can POST to the app — like every Server Action — so
 * validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * On success we `revalidatePath('/customers')` so the customers table's cached
 * data is purged and the new row streams in on the next render — no manual
 * refetch needed on the client. Like `/inventory` and `/suppliers`, the
 * `(dashboard)` route group is folder-only, so the public path is `/customers`.
 *
 * `loyaltyPoints` is intentionally NOT accepted on create: new customers
 * always start at 0 (the schema default). Only `updateCustomer` touches it,
 * so a stray form field here is ignored.
 */
export async function createCustomer(
  // No `prevState` here — the dialog invokes this directly via an event
  // handler rather than `useActionState`, so there is no `(prevState, formData)`
  // signature to honor. The whole page is refreshed by revalidatePath, so there
  // is no client state to merge anyway.
  formData: FormData,
): Promise<CreateCustomerResult> {
  const name = load(formData, "name");
  const email = load(formData, "email");
  const phone = load(formData, "phone");
  const address = load(formData, "address");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!name) return { ok: false, error: "Customer name is required." };

  // Email is optional but, when present, must be a believable shape.
  if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }

  // ── Insert ─────────────────────────────────────────────────────────────
  // `loyaltyPoints` is omitted from `data` so SQLite applies its DEFAULT 0.
  try {
    await prisma.customer.create({
      data: {
        name,
        email,
        phone,
        address,
      },
    });
  } catch {
    // The Customer model has no `@unique` columns (see schema note), so there
    // is no P2002 path to guard here — two customers of the same name/email
    // are legitimate. Anything unexpected is surfaced as a generic message
    // rather than leaking internals, and rethrown nothing so the UI stays
    // usable.
    return { ok: false, error: "Could not save the customer. Please try again." };
  }

  revalidatePath("/customers");
  return { ok: true, name };
}

/**
 * Edit an existing customer by its `id`.
 *
 * Like `createCustomer`, this is invoked directly from the dialog's event
 * handler, so it takes only the `formData` — no `prevState`. The row's `id`
 * travels as a hidden field in the same payload — same technique
 * `deleteCustomer` uses — so there is no second argument or curried closure
 * to worry about.
 *
 * Validation mirrors `createCustomer` (required `name`, optional-but-shape-
 * checked `email`) plus a parsed `loyaltyPoints`. We rely on Prisma's P2025
 * (record not found) surfacing as a generic error via the catch's fallthrough —
 * if the row was deleted after the page rendered, the user just sees "could
 * not save" and the revalidated table shows the row is already gone.
 *
 * `revalidatePath('/customers')` refreshes the cached table so the edited row
 * streams back in on the next render.
 */
export async function updateCustomer(
  // Invoked directly from the event handler rather than `useActionState`, so
  // there is no `prevState` to accept — the whole page is refreshed by
  // revalidatePath, nothing to merge.
  formData: FormData,
): Promise<UpdateCustomerResult> {
  const id = load(formData, "id");
  const name = load(formData, "name");
  const email = load(formData, "email");
  const phone = load(formData, "phone");
  const address = load(formData, "address");
  const loyalty = parseLoyaltyPoints(formData);

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!id) return { ok: false, error: "Missing customer. Please reopen and try again." };
  if (!name) return { ok: false, error: "Customer name is required." };
  if (loyalty.error) return { ok: false, error: loyalty.error };

  // Email is optional but, when present, must be a believable shape.
  if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }

  // ── Update ─────────────────────────────────────────────────────────────
  // `loyaltyPoints` is only included when the form actually sent it; otherwise
  // the column is left untouched (so an edit without the points field — if it
  // ever happens — keeps the accrued balance).
  const data: Record<string, unknown> = { name, email, phone, address };
  if (loyalty.value !== undefined) data.loyaltyPoints = loyalty.value;

  try {
    await prisma.customer.update({
      where: { id },
      data,
    });
  } catch {
    // No P2002 to guard (no unique columns). P2025 (record not found, if the
    // row was deleted mid-flight) and anything else is surfaced as a generic
    // message — no internals leaked, UI stays usable.
    return { ok: false, error: "Could not save the customer. Please try again." };
  }

  revalidatePath("/customers");
  return { ok: true };
}

/**
 * Delete a customer by its `id`.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement): the
 * row's hidden `id` field is the only payload. Customer has no inbound
 * relations in the schema, so there is no foreign-key violation to guard
 * against and no cascade to reason about — unlike `deleteProduct`, there is no
 * P2003 branch here.
 *
 * Like `createCustomer`, we `revalidatePath('/customers')` so the row is gone
 * from the cached table on the next render.
 */
export async function deleteCustomer(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return;
  }

  try {
    await prisma.customer.delete({ where: { id } });
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

  revalidatePath("/customers");
}

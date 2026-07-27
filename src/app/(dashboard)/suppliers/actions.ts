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
export type CreateSupplierResult = {
  ok: boolean;
  /** The first validation/server error to surface inline. */
  error?: string;
  /** The name of the row we created, so the client can confirm + close. */
  name?: string;
};

/** Result shape for `updateSupplier`. Mirrors `CreateSupplierResult` — the
 *  dialog observes it with `useActionState` and auto-closes on `ok` — but
 *  the success case has nothing to echo back (the page revalidates), so no
 *  `name` field is needed here. */
export type UpdateSupplierResult = {
  ok: boolean;
  /** The first validation/server error to surface inline. */
  error?: string;
};

/**
 * Server Action backing the "Add New Supplier" dialog.
 *
 * Reachable by anyone who can POST to the app — like every Server Action — so
 * validation is enforced here on the server, not just in the form. We never
 * trust the client to have run it.
 *
 * On success we `revalidatePath('/suppliers')` so the suppliers table's cached
 * data is purged and the new row streams in on the next render — no manual
 * refetch needed on the client. Like `/inventory`, the `(dashboard)` route
 * group is folder-only, so the public path is `/suppliers`.
 */
export async function createSupplier(
  // No `prevState` here — the dialog invokes this directly via an event
  // handler rather than `useActionState`, so there is no `(prevState, formData)`
  // signature to honor. The whole page is refreshed by revalidatePath, so there
  // is no client state to merge anyway.
  formData: FormData,
): Promise<CreateSupplierResult> {
  const name = load(formData, "name");
  const contactName = load(formData, "contactName");
  const email = load(formData, "email");
  const phone = load(formData, "phone");
  const address = load(formData, "address");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!name) return { ok: false, error: "Supplier name is required." };

  // Email is optional but, when present, must be a believable shape.
  if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }

  // ── Insert ─────────────────────────────────────────────────────────────
  try {
    await prisma.supplier.create({
      data: {
        name,
        contactName,
        email,
        phone,
        address,
      },
    });
  } catch (err) {
    // P2002 = unique-constraint violation; the only unique field here is `name`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: `A supplier named "${name}" already exists.` };
    }
    // Anything else is unexpected — surface a generic message rather than
    // leaking internals, and rethrow nothing so the UI stays usable.
    return { ok: false, error: "Could not save the supplier. Please try again." };
  }

  revalidatePath("/suppliers");
  return { ok: true, name };
}

/**
 * Edit an existing supplier by its `id`.
 *
 * Like `createSupplier`, this is invoked directly from the dialog's event
 * handler, so it takes only the `formData` — no `prevState`. The row's `id`
 * travels as a hidden field in the same payload — same technique
 * `deleteSupplier` uses — so there is no second argument or curried closure to
 * worry about.
 *
 * Validation mirrors `createSupplier` (required `name`, optional-but-shape-
 * checked `email`) and reuses the P2002 unique-`name` guard: editing a row to
 * a name another supplier already claims is the only unique violation possible
 * here. We rely on Prisma's P2025 (record not found) surfacing as a generic
 * error via the catch's fallthrough — if the row was deleted after the page
 * rendered, the user just sees "could not save" and the revalidated table
 * shows the row is already gone.
 *
 * `revalidatePath('/suppliers')` refreshes the cached table so the edited row
 * streams back in on the next render.
 */
export async function updateSupplier(
  // Invoked directly from the event handler rather than `useActionState`, so
  // there is no `prevState` to accept — the whole page is refreshed by
  // revalidatePath, nothing to merge.
  formData: FormData,
): Promise<UpdateSupplierResult> {
  const id = load(formData, "id");
  const name = load(formData, "name");
  const contactName = load(formData, "contactName");
  const email = load(formData, "email");
  const phone = load(formData, "phone");
  const address = load(formData, "address");

  // ── Required-field & shape validation (server-authoritative) ───────────
  if (!id) return { ok: false, error: "Missing supplier. Please reopen and try again." };
  if (!name) return { ok: false, error: "Supplier name is required." };

  // Email is optional but, when present, must be a believable shape.
  if (email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email address is not valid." };
  }

  // ── Update ─────────────────────────────────────────────────────────────
  try {
    await prisma.supplier.update({
      where: { id },
      data: { name, contactName, email, phone, address },
    });
  } catch (err) {
    // P2002 = unique-constraint violation; the only unique field here is `name`.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return { ok: false, error: `A supplier named "${name}" already exists.` };
    }
    // Anything else (incl. P2025 if the row was deleted mid-flight) is surfaced
    // as a generic message — no internals leaked, UI stays usable.
    return { ok: false, error: "Could not save the supplier. Please try again." };
  }

  revalidatePath("/suppliers");
  return { ok: true };
}

/**
 * Delete a supplier by its `id`.
 *
 * Form-driven (so it works with plain HTML and progressive enhancement): the
 * row's hidden `id` field is the only payload. `Product.supplier` is
 * `onDelete: SetNull` in the schema, so removing a supplier simply clears the
 * link on any products that referenced it — no foreign-key violation to guard
 * against, so unlike `deleteProduct` there is no P2003 branch here.
 *
 * Like `createSupplier`, we `revalidatePath('/suppliers')` so the row is gone
 * from the cached table on the next render.
 */
export async function deleteSupplier(formData: FormData): Promise<void> {
  const id = load(formData, "id");
  if (!id) {
    // No id means the form was tampered or malformed — nothing to delete.
    return;
  }

  try {
    await prisma.supplier.delete({ where: { id } });
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

  revalidatePath("/suppliers");
}

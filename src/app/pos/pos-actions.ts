"use server";

import { revalidatePath } from "next/cache";
import { createCustomer, type CustomerInput } from "@/app/(dashboard)/customers/actions";

/**
 * POS-owned server actions (Phase 4).
 *
 * The register needs a couple of things the sale flow does not have. They live
 * here rather than in the register component so that:
 *
 *  - every action still carries a `"use server"` boundary, and
 *  - the POS never reaches across route groups from a component. It calls
 *    through this module, which delegates to the action that already owns the
 *    business rule. `createPosCustomer` below is a THIN wrapper: the staff
 *    role gate, the field validation, the audit entry and the row write are all
 *    still the existing `createCustomer`, so there is exactly one create path
 *    for a customer whether it is started at the till or on the Customers page.
 */

/**
 * Creates a customer mid-sale and attaches them to the open cart.
 *
 * Reuses `createCustomer` wholesale rather than re-implementing any part of it.
 * The only additions are the two revalidations a POS caller needs: the Customers
 * list (the row now exists) and `/pos` itself, so a reload sees the new book.
 */
export async function createPosCustomer(
  input: Pick<CustomerInput, "name"> & { phone?: string | null },
) {
  const res = await createCustomer({ name: input.name, phone: input.phone ?? null });
  if (res.ok) {
    revalidatePath("/customers");
    revalidatePath("/pos");
  }
  return res;
}
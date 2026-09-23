"use server";

/**
 * Purchasing Server Actions (Phase 1: PO creation, edit, ordering, cancellation).
 *
 * Conventions mirror `src/app/(dashboard)/suppliers/actions.ts` exactly:
 *   - `"use server"` module
 *   - `staffGuardError()` → ADMIN/MANAGER only (mirrors suppliers module)
 *   - `load(formData, key)` for trimmed string fields
 *   - `ActionResult<T>` result shape from `@/lib/types`
 *   - `revalidatePath("/purchasing")` on success
 *
 * Phase 1 SCOPE — what these actions do NOT touch:
 *   - Product.stock (never read or written here)
 *   - Product.cost (never read or written here)
 *   - StockMovement (never created here)
 *   - Sale / Customer / accounting tables
 *
 * PO numbering:
 *   - Format: PO-YYYYMM-NNNNNN (e.g. PO-202609-000001)
 *   - Allocated atomically inside the creation Prisma transaction via the
 *     PoNumberCounter model — never client-side, never MAX+1.
 *
 * Status transitions (Phase 1 only):
 *   - DRAFT → ORDERED
 *   - DRAFT → CANCELLED
 *   - ORDERED → CANCELLED
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { ActionResult } from "@/lib/types";
import { roleGuardError, getCashier } from "@/lib/session";

/** Staff-only guard shared by every mutating action in this module. */
const STAFF_ROLES = ["ADMIN", "MANAGER"] as const;

async function staffGuardError(): Promise<string | null> {
  return roleGuardError(STAFF_ROLES);
}

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

/** Parse a numeric string field; returns undefined when absent, null when invalid. */
function loadInt(formData: FormData, key: string): number | undefined | null {
  const raw = load(formData, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
  return n;
}

/** Parse a Float money field; returns undefined when absent, null when invalid. */
function loadFloat(formData: FormData, key: string): number | undefined | null {
  const raw = load(formData, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Parse a date field; returns undefined when absent or empty. */
function loadDate(formData: FormData, key: string): string | undefined {
  return load(formData, key);
}

// ── Status vocabulary ──────────────────────────────────────────────────────
// NOTE: this constant is deliberately NOT exported. A `"use server"` module may
// only export async functions — exporting a value (`const ROLES`) once broke
// every action in the employees module. `export type` is tolerated because it
// erases at runtime, so `PoStatus` below is safe to re-export, but the *display*
// list lives with the UI in `./PoStatusPill.tsx`.
const PO_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

// Phase 1 + Phase 2 allowed transitions.
// Phase 1: DRAFT → ORDERED, DRAFT → CANCELLED, ORDERED → CANCELLED
// Phase 2: ORDERED → PARTIALLY_RECEIVED, ORDERED → RECEIVED,
//          PARTIALLY_RECEIVED → RECEIVED, PARTIALLY_RECEIVED → CANCELLED
const ALLOWED_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["CANCELLED", "PARTIALLY_RECEIVED", "RECEIVED"],
  PARTIALLY_RECEIVED: ["CANCELLED", "RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

// Statuses that allow receiving stock against the PO.
const RECEIVEABLE_STATUSES: readonly PoStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];

// ── Result types ──────────────────────────────────────────────────────────
export type CreatePoResult = ActionResult<{ poNumber?: string; id?: string }>;
export type UpdatePoResult = ActionResult<{ poNumber?: string }>;
export type OrderPoResult = ActionResult<{ poNumber?: string }>;
export type CancelPoResult = ActionResult<{ poNumber?: string }>;
export type StatusPoResult = ActionResult<{ poNumber: string; status: string }>;
export type ReceivePoResult = ActionResult<{
  referenceNumber: string;
  status: string;
  totalReceived: number;
  totalOrdered: number;
}>;
// ── Reader/query result shapes ─────────────────────────────────────────
// Read helpers below are plain queries (not Server Actions performing writes).
export type PoListItem = {
  id: string;
  poNumber: string;
  supplierName: string;
  status: PoStatus;
  orderDate: Date;
  expectedDate: Date | null;
  itemCount: number;
  total: number;
  createdByName: string;
};

export type PoItemDetail = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  orderedQty: number;
  unitCost: number;
  receivedQty: number;
  lineTotal: number;
};

export type PoDetail = {
  id: string;
  poNumber: string;
  status: PoStatus;
  supplierId: string;
  supplierName: string;
  orderDate: Date;
  expectedDate: Date | null;
  notes: string | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  items: PoItemDetail[];
  total: number;
  itemCount: number;
};


// ── PO number generation ────────────────────────────────────────────────────

/** Current month key for the PO counter, e.g. "202609". */
function currentMonthKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

/** Zero-pad the sequence to 6 digits (NNNNNN). */
function padSequence(n: number): string {
  return String(n).padStart(6, "0");
}

/**
 * Atomically allocate the next PO number for the current month.
 * Uses `update` with `increment` on PoNumberCounter.lastNumber inside the
 * transaction that creates the PO. SQLite serializes writes, and Prisma's
 * transaction acquires a write lock, so concurrent creators get distinct
 * sequence numbers without MAX+1 race conditions.
 */
async function allocatePoNumber(tx: any): Promise<string> {
  const month = currentMonthKey();
  const counter = await tx.poNumberCounter.upsert({
    where: { month },
    update: { lastNumber: { increment: 1 } },
    create: { month, lastNumber: 1 },
  });
    return `PO-${month}-${padSequence(counter.lastNumber)}`;
}

/**
 * Atomically allocate the next receiving reference number for the current month.
 * Uses `update` with `increment` on ReceiptNumberCounter.lastNumber — the exact
 * same pattern as {@link allocatePoNumber}, so concurrent receives get distinct
 * sequence numbers without race conditions.
 */
async function allocateReceiptNumber(tx: any): Promise<string> {
  const month = currentMonthKey();
  const counter = await tx.receiptNumberCounter.upsert({
    where: { month },
    update: { lastNumber: { increment: 1 } },
    create: { month, lastNumber: 1 },
  });
  return `RCPT-${month}-${padSequence(counter.lastNumber)}`;
}

type PoLineItemInput = {
  productId: string;
  orderedQty: number;
  unitCost: number;
};

// ── create ─────────────────────────────────────────────────────────────────

/**
 * Create a Purchase Order.
 *
 * On success the PO is persisted and the list/detail cache is revalidated.
 * Returns the new poNumber so the UI can confirm.
 *
 * NEVER modifies: Product.stock, Product.cost, StockMovement, Sale, Customer.
 */
export async function createPurchaseOrder(
  formData: FormData,
): Promise<CreatePoResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const supplierId = load(formData, "supplierId");
  const notes = load(formData, "notes");
  const expectedDateStr = loadDate(formData, "expectedDate");

  // Parse line items from FormData. Repeating pattern:
  //   productId=N, orderedQty=N, unitCost=N  (for N = 1..lineCount)
  const lineCountStr = load(formData, "lineCount");
  const lineCount = lineCountStr ? Number(lineCountStr) : 0;

  if (!supplierId) {
    return { ok: false, error: "Supplier is required." };
  }

  const items: PoLineItemInput[] = [];
  const seenProducts = new Set<string>();
  if (lineCount > 0 && Number.isFinite(lineCount) && lineCount === Math.floor(lineCount)) {
    for (let i = 1; i <= lineCount; i++) {
      const productId = load(formData, `productId_${i}`);
      const qty = loadInt(formData, `orderedQty_${i}`);
      const cost = loadFloat(formData, `unitCost_${i}`);

      if (productId === undefined) continue;
      if (qty === undefined) continue;
      if (cost === undefined) continue;

      if (qty === null) {
        return { ok: false, error: `Line ${i}: quantity must be a positive whole number.` };
      }
      if (cost === null) {
        return { ok: false, error: `Line ${i}: unit cost must be a number.` };
      }
      if (qty <= 0) {
        return { ok: false, error: `Line ${i}: quantity must be greater than zero.` };
      }
      if (cost < 0) {
        return { ok: false, error: `Line ${i}: unit cost cannot be negative.` };
      }
      if (seenProducts.has(productId)) {
        return { ok: false, error: `Line ${i}: this product is already added to the order.` };
      }
      seenProducts.add(productId);
      items.push({ productId, orderedQty: qty, unitCost: cost });
    }
  }

  if (items.length === 0) {
    return { ok: false, error: "At least one line item is required." };
  }

  // Validate supplier exists.
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  });
  if (!supplier) {
    return { ok: false, error: "Supplier not found." };
  }

  // Validate all products exist.
  const productIds = items.map((it) => it.productId);
  const existingProducts = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  if (existingProducts.length !== productIds.length) {
    return { ok: false, error: "One or more products were not found." };
  }

  // Get current user (creator) from the session cookie.
  const cashier = await getCashier();
  const createdById = cashier?.id;
  if (!createdById) {
    return { ok: false, error: "You must be signed in to create a purchase order." };
  }

  // Validate expectedDate if provided.
  let expectedDate: Date | undefined = undefined;
  if (expectedDateStr) {
    const parsed = new Date(expectedDateStr);
    if (!Number.isNaN(parsed.getTime())) expectedDate = parsed;
  }

  // Allocate PO number and create everything atomically.
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const poNumber = await allocatePoNumber(tx);
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          notes: notes ?? undefined,
          expectedDate,
          createdById,
          items: {
            create: items.map((it) => ({
              productId: it.productId,
              orderedQty: it.orderedQty,
              unitCost: it.unitCost,
            })),
          },
        },
        select: { id: true, poNumber: true },
      });
      return po;
    });

    revalidatePath("/purchasing");
    return { ok: true, poNumber: result.poNumber, id: result.id };
  } catch (err: any) {
    if (err?.code === "P2002") {
      return { ok: false, error: "A purchase order with this number already exists. Please try again." };
    }
    return { ok: false, error: "Could not create the purchase order. Please try again." };
  }
}

// ── update (edit) ──────────────────────────────────────────────────────────

/**
 * Update a Purchase Order. Status-aware:
 *   DRAFT  → can edit supplier, items, quantities, unit costs, expected date, notes
 *   ORDERED → can edit ONLY expected date + notes
 *   CANCELLED → no editing allowed
 */
export async function updatePurchaseOrder(
  formData: FormData,
): Promise<UpdatePoResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const id = load(formData, "id");
  if (!id) return { ok: false, error: "Missing purchase order id." };

  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, status: true, poNumber: true },
  });
  if (!po) return { ok: false, error: "Purchase order not found." };

  if (po.status === "CANCELLED") {
    return { ok: false, error: "Cancelled purchase orders cannot be edited." };
  }

  const isDraft = po.status === "DRAFT";

  const notes = load(formData, "notes");
  const expectedDateStr = loadDate(formData, "expectedDate");

  let expectedDate: Date | undefined = undefined;
  if (expectedDateStr) {
    const parsed = new Date(expectedDateStr);
    if (!Number.isNaN(parsed.getTime())) expectedDate = parsed;
  }

  if (isDraft) {
    // Full edit: supplier, items, quantities, unit costs, dates, notes.
    const supplierId = load(formData, "supplierId");
    if (supplierId) {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true },
      });
      if (!supplier) {
        return { ok: false, error: "Supplier not found." };
      }
    }

    const lineCountStr = load(formData, "lineCount");
    const lineCount = lineCountStr ? Number(lineCountStr) : 0;
    const items: PoLineItemInput[] = [];
    const seenProducts = new Set<string>();

    if (lineCount > 0 && Number.isFinite(lineCount) && lineCount === Math.floor(lineCount)) {
      for (let i = 1; i <= lineCount; i++) {
        const productId = load(formData, `productId_${i}`);
        const qty = loadInt(formData, `orderedQty_${i}`);
        const cost = loadFloat(formData, `unitCost_${i}`);

        if (productId === undefined) continue;
        if (qty === undefined) continue;
        if (cost === undefined) continue;

        if (qty === null) {
          return { ok: false, error: `Line ${i}: quantity must be a positive whole number.` };
        }
        if (cost === null) {
          return { ok: false, error: `Line ${i}: unit cost must be a number.` };
        }
        if (qty <= 0) {
          return { ok: false, error: `Line ${i}: quantity must be greater than zero.` };
        }
        if (cost < 0) {
          return { ok: false, error: `Line ${i}: unit cost cannot be negative.` };
        }
        if (seenProducts.has(productId)) {
          return { ok: false, error: `Line ${i}: this product is already added to the order.` };
        }
        seenProducts.add(productId);
        items.push({ productId, orderedQty: qty, unitCost: cost });
      }
    }

    if (items.length === 0) {
      return { ok: false, error: "At least one line item is required." };
    }

    const productIds = items.map((it) => it.productId);
    const existingProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    if (existingProducts.length !== productIds.length) {
      return { ok: false, error: "One or more products were not found." };
    }

    try {
      await prisma.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: supplierId ?? undefined,
          notes: notes ?? undefined,
          expectedDate: expectedDate ?? undefined,
          items: {
            deleteMany: {},
            create: items.map((it) => ({
              productId: it.productId,
              orderedQty: it.orderedQty,
              unitCost: it.unitCost,
            })),
          },
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return { ok: false, error: "Duplicate product in order." };
      }
      return { ok: false, error: "Could not update the purchase order. Please try again." };
    }
  } else if (po.status === "ORDERED") {
    // ORDERED: only expected date + notes are editable.
    try {
      await prisma.purchaseOrder.update({
        where: { id },
        data: {
          notes: notes ?? undefined,
          expectedDate: expectedDate ?? undefined,
        },
      });
    } catch {
      return { ok: false, error: "Could not update the purchase order. Please try again." };
    }
  } else {
    return { ok: false, error: `Cannot edit a purchase order in ${po.status} status.` };
  }

  revalidatePath("/purchasing");
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, poNumber: po.poNumber };
}

function canTransition(from: PoStatus, to: PoStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Mark a DRAFT PO as ORDERED. Phase 1 only: no stock/cost/movement effects. */
export async function orderPurchaseOrder(
  formData: FormData,
): Promise<StatusPoResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const id = load(formData, "id");
  if (!id) return { ok: false, error: "Missing purchase order id." };
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, status: true, poNumber: true },
  });
  if (!po) return { ok: false, error: "Purchase order not found." };
  if (!canTransition(po.status as PoStatus, "ORDERED")) {
    return { ok: false, error: `Cannot order a purchase order in ${po.status} status.` };
  }
  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "ORDERED" },
  });
  revalidatePath("/purchasing");
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, poNumber: po.poNumber, status: "ORDERED" };
}

/** Cancel a DRAFT or ORDERED PO. Status-only; nothing else changes. */
export async function cancelPurchaseOrder(
  formData: FormData,
): Promise<StatusPoResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };
  const id = load(formData, "id");
  if (!id) return { ok: false, error: "Missing purchase order id." };
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    select: { id: true, status: true, poNumber: true },
  });
  if (!po) return { ok: false, error: "Purchase order not found." };
  if (!canTransition(po.status as PoStatus, "CANCELLED")) {
    return { ok: false, error: `Cannot cancel a purchase order in ${po.status} status.` };
  }
  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
    revalidatePath("/purchasing");
  revalidatePath(`/purchasing/${id}`);
  return { ok: true, poNumber: po.poNumber, status: "CANCELLED" };
}

// ── Phase 2: Purchase Receiving ──────────────────────────────────────────────

/**
 * Receive stock against an ORDERED or PARTIALLY_RECEIVED purchase order.
 *
 * The receiving payload mirrors the PO create form's line convention, but with
 * `itemId_N` / `receiveQty_N` instead of `productId_N` / `orderedQty_N`:
 *   id, lineCount, receiveQty_1, receiveQty_2, … notes
 *
 * All validation, stock increments, PO receivedQty bumps, StockMovement writes,
 * and PO status recalculation happen inside a single Prisma `$transaction`.
 * If anything fails, the entire transaction rolls back — there is no path where
 * Product.stock is incremented but the receipt is not recorded (or vice-versa).
 *
 * NEVER modifies: Sale, Customer, CustomerPayment, accounting entries,
 *   employee records, supplier balances, loyalty points.
 */
export async function receivePurchaseOrder(
  formData: FormData,
): Promise<ReceivePoResult> {
  const denied = await staffGuardError();
  if (denied) return { ok: false, error: denied };

  const id = load(formData, "id");
  if (!id) return { ok: false, error: "Missing purchase order id." };

  const notes = load(formData, "notes");

  // Parse receiving quantities per line.
  const lineCountStr = load(formData, "lineCount");
    const lineCount = lineCountStr ? Number(lineCountStr) : 0;

  const receiptLines: { itemId: string; qty: number }[] = [];
  if (
    lineCount > 0 &&
    Number.isFinite(lineCount) &&
    lineCount === Math.floor(lineCount)
  ) {
    for (let i = 1; i <= lineCount; i++) {
      const itemId = load(formData, `itemId_${i}`);
      const qtyRaw = load(formData, `receiveQty_${i}`);
      if (itemId === undefined) continue;
      if (qtyRaw === undefined) continue;

      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty < 0) {
        return {
          ok: false,
          error: `Line ${i}: received quantity must be a whole number ≥ 0.`,
        };
      }
      receiptLines.push({ itemId, qty });
    }
  }

  // At least one line must have a positive quantity.
  const hasPositive = receiptLines.some((l) => l.qty > 0);
  if (!hasPositive) {
    return { ok: false, error: "At least one line must have a positive received quantity." };
  }

  const receivedById = (await getCashier())?.id;
  if (!receivedById) {
    return { ok: false, error: "You must be signed in to receive stock." };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // Load the PO and its items with products for stock lookup.
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: { createdAt: "asc" },
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
      });

      if (!po) {
        throw new Error("PURCHASE_ORDER_NOT_FOUND");
      }

      if (!RECEIVEABLE_STATUSES.includes(po.status as PoStatus)) {
        throw new Error(
          `Cannot receive against a purchase order in ${po.status} status.`,
        );
      }

      // Build a quick lookup: itemId → item.
      const itemMap = new Map<string, (typeof po.items)[number]>();
      for (const item of po.items) {
        itemMap.set(item.id, item);
      }

      // Validate every requested line.
      for (const line of receiptLines) {
        const item = itemMap.get(line.itemId);
        if (!item) {
          throw new Error("One or more line items were not found on this purchase order.");
        }
        const remaining = item.orderedQty - item.receivedQty;
        if (line.qty > remaining) {
          throw new Error(
            `Line "${item.product.name}" (${item.product.sku}): cannot receive ${line.qty}, only ${remaining} remaining.`,
          );
        }
      }

      // Allocate the receiving reference number (server-side, atomic).
      const referenceNumber = await allocateReceiptNumber(tx);

      // Create the receipt header.
      const receipt = await tx.purchaseReceipt.create({
        data: {
          purchaseOrderId: po.id,
          receivedById,
          receivedAt: new Date(),
          referenceNumber,
          notes: notes ?? undefined,
        },
      });

      // Create receipt items, bump PO receivedQty, increment Product.stock,
      // and log a StockMovement for every received product — all in the same
      // transaction so they all succeed or all roll back.
      for (const line of receiptLines) {
        if (line.qty <= 0) continue;

        const item = itemMap.get(line.itemId)!;

        await tx.purchaseReceiptItem.create({
          data: {
            purchaseReceiptId: receipt.id,
            purchaseOrderItemId: item.id,
            receivedQty: line.qty,
          },
        });

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: line.qty } },
        });

        await tx.product.update({
          where: { id: item.product.id },
          data: { stock: { increment: line.qty } },
        });

        // Reuse the existing StockMovement ledger — one row per received
        // product, with the PO reference in the reason for traceability.
        await tx.stockMovement.create({
          data: {
            productId: item.product.id,
            quantityChange: line.qty,
            type: "RESTOCK",
            reason: `PO ${po.poNumber} receipt ${referenceNumber}`,
          },
        });
      }

      // Recalculate PO status from DB values.
      const updatedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
        select: { orderedQty: true, receivedQty: true },
      });

      const totalOrdered = updatedItems.reduce((s: number, it: any) => s + it.orderedQty, 0);
      const totalReceived = updatedItems.reduce((s: number, it: any) => s + it.receivedQty, 0);

      let status: PoStatus;
      if (totalReceived === 0) {
        status = po.status as PoStatus;
      } else if (totalReceived >= totalOrdered) {
        status = "RECEIVED";
      } else {
        status = "PARTIALLY_RECEIVED";
      }

      if (status !== po.status) {
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status },
        });
      }

      return { referenceNumber, status, totalReceived, totalOrdered };
    });

    revalidatePath("/purchasing");
    revalidatePath(`/purchasing/${id}`);
    return { ok: true, ...result };
  } catch (err: any) {
    if (err?.message === "PURCHASE_ORDER_NOT_FOUND") {
      return { ok: false, error: "Purchase order not found." };
    }
    if (
      err?.message?.includes("status") &&
      err?.message?.includes("Cannot receive")
    ) {
      return { ok: false, error: err.message };
    }
    if (
      err?.message?.includes("not found on this purchase order") ||
      err?.message?.includes("cannot receive") ||
      err?.message?.includes("positive")
    ) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Could not record the receipt. Please try again." };
  }
}

// readers (plain queries; NOT mutating Server Actions)

/** List all POs newest-first with computed line totals. */
export async function getPurchaseOrders(): Promise<PoListItem[]> {
  const rows = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { select: { orderedQty: true, unitCost: true } },
    },
  });
  return rows.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    supplierName: po.supplier?.name ?? String.fromCharCode(8212),
    status: po.status as PoStatus,
    orderDate: po.orderDate,
    expectedDate: po.expectedDate ?? null,
    itemCount: po.items.length,
    total: po.items.reduce((s, it) => s + it.orderedQty * it.unitCost, 0),
    createdByName: po.createdBy?.name ?? String.fromCharCode(8212),
  }));
}

/** Read type for one receipt + its items, joined with product info. */
export type ReceiptHistoryView = {
  id: string;
  referenceNumber: string;
  receivedAt: Date;
  receivedByName: string;
  notes: string | null;
  items: {
    productName: string;
    productSku: string;
    receivedQty: number;
  }[];
};

/**
 * Read the receiving history for one PO — backs the "Receiving History"
 * section on the PO detail page. Joins receipt → receipt item → PO line item
 * → product so each line shows name, SKU, and quantity received.
 */
export async function getReceivingHistory(poId: string): Promise<ReceiptHistoryView[]> {
  const rows = await prisma.purchaseReceipt.findMany({
    where: { purchaseOrderId: poId },
    orderBy: { receivedAt: "desc" },
    include: {
      receivedBy: { select: { name: true } },
      items: {
        include: {
          purchaseOrderItem: {
            include: { product: { select: { name: true, sku: true } } },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    referenceNumber: r.referenceNumber,
    receivedAt: r.receivedAt,
    receivedByName: r.receivedBy?.name ?? String.fromCharCode(8212),
    notes: r.notes,
    items: r.items.map((it) => ({
      productName: it.purchaseOrderItem.product?.name ?? "Unknown product",
      productSku: it.purchaseOrderItem.product?.sku ?? "N/A",
      receivedQty: it.receivedQty,
    })),
  }));
}

/** Fetch one PO with lines plus computed totals. */
export async function getPurchaseOrder(id: string): Promise<PoDetail | null> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: { select: { name: true, sku: true } } },
      },
    },
  });
  if (!po) return null;
  const items: PoItemDetail[] = po.items.map((it) => ({
    id: it.id,
    productId: it.productId,
    productName: it.product.name,
    productSku: it.product.sku,
    orderedQty: it.orderedQty,
    unitCost: it.unitCost,
    receivedQty: it.receivedQty,
    lineTotal: it.orderedQty * it.unitCost,
  }));
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status as PoStatus,
    supplierId: po.supplierId,
    supplierName: po.supplier?.name ?? 'Unknown supplier',
    orderDate: po.orderDate,
    expectedDate: po.expectedDate ?? null,
    notes: po.notes ?? null,
    createdById: po.createdById,
    createdByName: po.createdBy?.name ?? 'Unknown user',
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
    items,
    total: items.reduce((s, it) => s + it.lineTotal, 0),
    itemCount: items.length,
  };
}

/** Suppliers for the PO create/edit select, ordered by name. */
export async function getSuppliersForSelect(): Promise<{ id: string; name: string }[]> {
  return prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Products for the PO line-item select, ordered by name. */
export async function getProductsForSelect(): Promise<{ id: string; name: string; sku: string }[]> {
  return prisma.product.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true },
  });
}

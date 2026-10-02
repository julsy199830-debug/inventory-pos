import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageAuth } from "@/lib/session";
import Receipt, { type ReceiptStore } from "@/app/pos/Receipt";
import PrintButton from "./PrintButton";

/**
 * `/my-transactions/[id]` â€” one of YOUR sales, with its receipt (Phase 5).
 *
 * The scope is a single `AND` in the query, not a filter applied afterwards:
 *
 *   prisma.sale.findFirst({ where: { id, cashierId: me.id } })
 *
 * `id` comes from the URL, so it IS attacker-controlled â€” but because it is
 * combined with the session's own `cashierId` in the WHERE clause, pointing it
 * at another cashier's sale simply matches nothing and `notFound()` renders a
 * 404. There is no code path that fetches a sale and then checks, which is
 * where this class of bug usually leaks.
 *
 * The receipt is the SAME `Receipt` component the register prints, driven by
 * the persisted sale rather than a checkout-time snapshot, so a reprint matches
 * the original slip and cannot drift from it.
 */
export default async function MyTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requirePageAuth();
  const { id } = await params;

  const [sale, settings] = await Promise.all([
    prisma.sale.findFirst({
      // The AND is the authorization. See the file header.
      where: { id, cashierId: me.id },
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        subtotal: true,
        discountAmount: true,
        tax: true,
        paymentMethod: true,
        status: true,
        tendered: true,
        change: true,
        voidReason: true,
        voidedAt: true,
        refundedAmount: true,
        redeemedPoints: true,
        redemptionAmount: true,
        earnedPoints: true,
        customer: { select: { name: true } },
        items: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            quantity: true,
            refundedQuantity: true,
            priceAtSale: true,
            product: { select: { name: true } },
          },
        },
        refunds: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            amount: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.storeSetting.findFirst(),
  ]);

  if (!sale) notFound();

  const store: ReceiptStore = {
    storeName: settings?.storeName ?? "InvPos Store",
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    currencySymbol: settings?.currencySymbol ?? "â‚±",
  };
return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link
            href="/my-transactions"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            â† My transactions
          </Link>
          <PrintButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Transaction
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                {sale.id}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {sale.createdAt.toLocaleString()} Â·{" "}
                {sale.customer?.name ?? "Walk-in Customer"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Status
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {sale.status}
              </p>
              {sale.refundedAmount > 0 && (
                <p className="text-xs font-semibold text-amber-700">
                  Refunded {store.currencySymbol}
                  {sale.refundedAmount.toFixed(2)}
                </p>
              )}
              {sale.voidReason && (
                <p className="text-xs font-semibold text-red-700">
                  {sale.voidReason}
                </p>
              )}
            </div>
          </div>

          {sale.refunds.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-slate-200 pt-3">
              {sale.refunds.map((r) => (
                <li key={r.id} className="text-xs text-slate-600">
                  Refunded {store.currencySymbol}
                  {r.amount.toFixed(2)} Â· {r.reason} Â·{" "}
                  <span className="tabular-nums">
                    {r.createdAt.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The same component the register prints, at its real 80mm width. */}
        <div className="flex justify-center overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
          <Receipt
            store={store}
            saleId={sale.id}
            timestamp={sale.createdAt.toISOString()}
            lines={sale.items.map((it) => ({
              name: it.product?.name ?? "Unknown product",
              qty: it.quantity,
              unitPrice: it.priceAtSale,
            }))}
            subtotal={sale.subtotal}
            discount={sale.discountAmount}
            tax={sale.tax}
            total={sale.totalAmount}
            redeemedPoints={sale.redeemedPoints}
            redemptionAmount={sale.redemptionAmount}
            earnedPoints={sale.earnedPoints}
            paymentMethod={sale.paymentMethod}
            tendered={sale.tendered}
            change={sale.change}
            cashierName={me.name}
            customerName={sale.customer?.name ?? null}
            taxRate={settings?.taxRate ?? 0}
          />
        </div>

        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Printer className="h-3.5 w-3.5" aria-hidden />
          Printing outputs only this receipt.
        </p>
      </main>
    </div>
  );
}
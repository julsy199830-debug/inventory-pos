import { prisma } from "./db";
import {
  DEFAULT_FORMAT,
  resolveFormat,
  type FormatSettings,
} from "./format";

/**
 * Phase 6 — the server half of the shared configuration layer.
 *
 * `src/lib/format.ts` knows how to FORMAT; this knows where the values come
 * from. Splitting them is what keeps `format.ts` pure (so client islands and
 * unit tests can import it) while guaranteeing every Server Component starts
 * from the same row.
 *
 * `StoreSetting` is a singleton by convention: `saveSettings` upserts a fixed id.
 * `getFormatSettings` therefore reads the first row rather than trusting a
 * caller-supplied id, and returns {@link DEFAULT_FORMAT} when the store has
 * never been configured — a fresh install must still be able to print a receipt.
 */
export async function getFormatSettings(): Promise<FormatSettings> {
  try {
    const row = await prisma.storeSetting.findFirst();
    return resolveFormat(row);
  } catch {
    // A brand-new database has no migrations applied yet; formatting defaults
    // are better than taking down the whole page.
    return DEFAULT_FORMAT;
  }
}

/** The full store identity printed on receipts and statements. */
export type StoreIdentity = {
  storeName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  receiptFooter: string | null;
};

/**
 * The store's contact block. Kept separate from {@link FormatSettings} because
 * these are presentation strings with no formatting behaviour, and a page that
 * only needs the currency should not carry the address around.
 */
export async function getStoreIdentity(): Promise<StoreIdentity> {
  try {
    const row = await prisma.storeSetting.findFirst({
      select: {
        storeName: true,
        address: true,
        phone: true,
        email: true,
        receiptFooter: true,
      },
    });
    return row ?? {
      storeName: "Store",
      address: null,
      phone: null,
      email: null,
      receiptFooter: null,
    };
  } catch {
    return {
      storeName: "Store",
      address: null,
      phone: null,
      email: null,
      receiptFooter: null,
    };
  }
}

/**
 * Everything a receipt or statement needs, in one read.
 *
 * These pages used to fetch the settings row themselves and each grew its own
 * slightly different idea of which fields were required. One loader means one
 * shape, so the print path cannot drift from the on-screen path.
 */
export async function getStorePresentation(): Promise<{
  format: FormatSettings;
  store: StoreIdentity;
}> {
  const [format, store] = await Promise.all([
    getFormatSettings(),
    getStoreIdentity(),
  ]);
  return { format, store };
}
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  createProduct,
  uploadProductImage,
  type CreateProductResult,
} from "./actions";
import { Modal } from "@/app/_components/ui/Modal";
import ProductImageField from "./ProductImageField";
import {
  Field,
  FormError,
  dialogPrimaryCls,
  dialogSecondaryCls,
  inputCls,
} from "@/app/_components/ui/Field";

/** One selectable option in the category dropdown. The empty-string id is the
 * "Uncategorized" sentinel the server accepts (it coerces `""`/absent to null). */
export type CategoryOption = { id: string; name: string };

/**
 * Modal dialog for creating a new product.
 *
 * The dialog mounts its own modal overlay once `open` is set, then submits via a
 * manual async handler that `await`s the raw `createProduct` Server Action
 * directly. Server Actions are async functions that resolve to their declared
 * return type, so awaiting one gives us the result in the same tick — we close +
 * reset the form right there on success, no effect needed. (This is the
 * "Event Handlers" calling convention from the mutating-data docs.)
 *
 * We deliberately don't use `useActionState` here. Its `(state, action, pending)`
 * triple is built for `<form action={...}>` wiring, and the idiomatic way to
 * react to its success is `setState` inside an effect keyed on `state` — which
 * `react-hooks/set-state-in-effect` flags as a derived-state cascade. Calling the
 * action ourselves sidesteps that entirely: the close/reset lives in the submit
 * handler, where side effects belong, not in a render-following effect.
 *
 * Note on progressive enhancement: the modal itself is gated behind `{open && …}`,
 * so a JS-disabled client can never reach the form to submit it. `<form action>`
 * would therefore buy nothing real here, and a manual JS submit is the honest
 * shape. Self-contained client island that owns the trigger + modal together so
 * the parent page stays a pure Server Component — the same structure as the
 * suppliers `AddSupplierDialog`.
 *
 * Category is chosen from a managed `<select>` populated server-side (the page
 * passes the current set of {@link CategoryOption}s), so a product is always
 * linked to a real {@link Category} id or left uncategorized — the old free-text
 * `category` field is gone. The field is named `categoryId` to match what
 * {@link createProduct} reads; an empty value means "uncategorized" and is a
 * legal, intentional choice.
 */
export default function AddProductDialog({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  // We drive `pending`/`error` ourselves from the awaited action result rather
  // than reading them out of `useActionState` — same UX (inputs + buttons lock
  // while submitting, error renders inline), but no setState-in-effect.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref onto the form so we can reset it once the insert succeeds — the next
  // time the dialog opens it's a blank form rather than the just-submitted row.
  const formRef = useRef<HTMLFormElement>(null);
  // A photo chosen before the product exists has nowhere to live yet (uploads
  // are keyed to a product id), so we hold the File here and attach it in the
  // same Save click once the insert hands back the new id. One form, one save.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  // Mirrors the name input purely so the photo fallback can show real initials
  // while the clerk is still typing. The form itself stays uncontrolled.
  const [nameValue, setNameValue] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    // The staged file must NOT ride along in this FormData: `createProduct`
    // validates `imageUrl` only, and shipping a File under an unrelated name
    // would just bloat the POST past the framework's body limit.
    formData.delete("image");
    setPending(true);
    setError(null);
    const result: CreateProductResult = await createProduct(formData);
    if (!result.ok) {
      setPending(false);
      setError(result.error ?? null);
      return;
    }
    // Attach the staged photo now that the row exists. A failure here is
    // non-fatal — the product was created, and the clerk can retry the photo
    // from the row without re-entering the product.
    if (pendingImage && result.id) {
      const body = new FormData();
      body.append("id", result.id);
      body.append("image", pendingImage);
      const uploaded = await uploadProductImage(body);
      if (!uploaded.ok) {
        setPending(false);
        setOpen(false);
        formRef.current?.reset();
        setPendingImage(null);
        toast.error(`${result.sku} was saved, but the photo failed: ${uploaded.error}`);
        return;
      }
    }
    setPending(false);
    setOpen(false);
    setPendingImage(null);
    formRef.current?.reset();
  }

  function onClose() {
    if (pending) return; // don't dismiss mid-submit
    setOpen(false);
  }

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        <svg
          className="h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
        Add New Product
      </button>

      {open && (
        <Modal
          open
          onClose={onClose}
          title="Add New Product"
          description="Add an item to the catalog so it can be sold at the register."
          className="max-w-2xl"
          busy={pending}
        >
          <form onSubmit={onSubmit} ref={formRef} className="space-y-4">
            <FormError>{error}</FormError>

            <Field label="Product name" htmlFor="name" required>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  disabled={pending}
                  placeholder="e.g. Aurora Wireless Headphones"
                  onChange={(e) => setNameValue(e.target.value)}
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="SKU" htmlFor="sku" required>
                  <input
                    id="sku"
                    name="sku"
                    type="text"
                    required
                    disabled={pending}
                    placeholder="e.g. ELEC-0004"
                    className={`${inputCls} font-mono`}
                  />
                </Field>
                <Field label="Category" htmlFor="categoryId">
                  <select
                    id="categoryId"
                    name="categoryId"
                    disabled={pending}
                    defaultValue=""
                    className={inputCls}
                  >
                    {/* value="" is the "Uncategorized" sentinel the server
                        coerces to null; kept first so it reads as the default. */}
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Retail price (PHP)" htmlFor="price" required>
                  <input
                    id="price"
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    required
                    disabled={pending}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </Field>
                <Field label="Cost price (PHP)" htmlFor="cost" required>
                  <input
                    id="cost"
                    name="cost"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    required
                    disabled={pending}
                    placeholder="0.00"
                    className={inputCls}
                  />
                </Field>
                <Field label="Stock" htmlFor="stock" required>
                  <input
                    id="stock"
                    name="stock"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    required
                    disabled={pending}
                    placeholder="0"
                    className={inputCls}
                  />
                </Field>
              </div>

              {/* Photo gets its own full-width section rather than a third of a
                  three-column grid: choosing an image is a deliberate act, and a
                  1/3-width drop target on a counter tablet is not a target. */}
              <section className="space-y-3 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Photo
                </h3>
                <ProductImageField
                  productName={nameValue}
                  pending={pending}
                  onFileSelected={setPendingImage}
                  onImageUrlChange={() => setPendingImage(null)}
                />
                {pendingImage ? (
                  <p className="text-xs text-slate-500">
                    This photo is attached when the product is saved.
                  </p>
                ) : null}
              </section>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className={dialogSecondaryCls}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className={dialogPrimaryCls}
              >
                {pending ? "Saving…" : "Save product"}
              </button>
            </div>
            </form>
        </Modal>
      )}
    </>
  );
}

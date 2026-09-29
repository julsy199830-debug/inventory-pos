"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { removeProductImage, uploadProductImage } from "./actions";
import { FormError } from "@/app/_components/ui/Field";
import ProductThumb from "@/app/_components/ui/ProductThumb";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_FORMAT_HINT,
  formatImageBytes,
  validateImageBytes,
} from "@/lib/product-image";

/**
 * The photo area of the product form: pick (or drop) a file, see it before it is
 * saved, replace it, or remove it entirely.
 *
 * Design decisions that matter for a shop clerk on a counter tablet:
 *
 *  - **Preview before upload.** The chosen file is shown immediately via a
 *    local object URL, so a mis-shot photo is caught before anything is written
 *    rather than after a re-render. The URL is revoked on change/unmount so a
 *    long session doesn't leak blobs.
 *
 *  - **The same validator on both sides.** `validateImageBytes` is imported from
 *    the shared module the Server Action uses, so the message shown here is the
 *    message the server would give. Client-side checks are for speed; the action
 *    re-runs them because it's a public endpoint.
 *
 *  - **URL entry is kept, not replaced.** A LAN store may host photos on a NAS
 *    or another machine; `parseImageUrl` already validates those, and dropping
 *    the field would strand that setup.
 *
 *  - **The form still owns the URL.** The hidden `imageUrl` input is kept in sync
 *    so a plain Save/Submit (Add dialog) never wipes a photo that was attached
 *    out-of-band.
 */
export default function ProductImageField({
  productId,
  productName,
  name = "imageUrl",
  defaultImageUrl,
  pending = false,
  onFileSelected,
  onImageUrlChange,
}: {
  /** Present once the product exists — enables upload/replace/remove. Omitted in
   *  the Add dialog until the row is created. */
  productId?: string;
  /** Product name, used only for the "no photo" initials fallback and alt text. */
  productName?: string;
  /** Name of the form field carrying the URL. */
  name?: string;
  /** Currently stored photo (managed path or external URL). */
  defaultImageUrl?: string | null;
  /** Locks the control while the parent form is saving. */
  pending?: boolean;
  /** Called with a validated `File` when there is no `productId` to upload it
   *  against yet — the Add dialog stages it and attaches it after the insert. */
  onFileSelected?: (file: File) => void;
  /** Notified whenever the effective image URL changes, so a parent form can
   *  clear its own `imageUrl` field. */
  onImageUrlChange?: (url: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // The value the parent form will submit. Kept in state so Remove can blank it
  // without the field going uncontrolled.
  const [imageUrl, setImageUrl] = useState<string>(defaultImageUrl ?? "");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaId = useId();

  // Re-opening the dialog against a different product (or a revalidated URL)
  // must drop the previous row's staged preview. React's documented way to
  // "adjust state when a prop changes" is during render, not in an effect — an
  // effect here would cascade a second render pass.
  const resetKey = `${productId ?? ""}|${defaultImageUrl ?? ""}`;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setImageUrl(defaultImageUrl ?? "");
    setPreview(null);
    setError(null);
  }

  // Object URLs are a manual resource. Revoking in an effect cleanup (rather
  // than inline at each call site) guarantees the displaced blob is released
  // exactly once, when the preview changes and again on unmount.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function applyLocal(file: File): Promise<boolean> {
    setError(null);
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      setPreview(null);
      setError(`Images must be ${formatImageBytes(MAX_PRODUCT_IMAGE_BYTES)} or smaller.`);
      return false;
    }
    // Reuse the server's exact validator so the wording matches, and so a file
    // that is secretly an HTML/SVG document is refused before it is ever staged.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const invalid = validateImageBytes(bytes);
    if (invalid) {
      setPreview(null);
      setError(invalid);
      return false;
    }
    setPreview(URL.createObjectURL(file));
    return true;
  }

  /**
   * Validate, preview, then either upload immediately (the row already exists)
   * or hand the File to the parent (the Add dialog, which cannot upload until
   * the product has been created).
   */
  async function handleFile(file: File): Promise<void> {
    if (!(await applyLocal(file))) return;
    if (productId) await upload(file);
    else onFileSelected?.(file);
  }

  async function upload(file: File): Promise<void> {
    if (!productId) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("id", productId);
    body.append("image", file);
    const result = await uploadProductImage(body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(null);
    setImageUrl(result.data.imageUrl ?? "");
    onImageUrlChange?.(result.data.imageUrl ?? null);
    toast.success("Product photo updated.");
  }

  async function onRemove(): Promise<void> {
    if (!productId) return;
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.append("id", productId);
    const result = await removeProductImage(body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPreview(null);
    setImageUrl("");
    onImageUrlChange?.(null);
    toast.success("Product photo removed.");
  }

  // The staged preview wins, so a clerk sees what they just picked rather than
  // the old photo still sitting in the row.
  const shown = preview ?? imageUrl ?? "";

  return (
    <div className="space-y-3">
      {/* Hidden file input, driven by the styled drop zone below. */}
      <input
        ref={inputRef}
        id={areaId}
        type="file"
        accept={PRODUCT_IMAGE_ACCEPT}
        className="sr-only"
        disabled={pending || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          // Reset so re-picking the same file still fires a change event.
          e.target.value = "";
        }}
      />

      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Preview: staged file, stored photo, or the initials fallback. */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <ProductThumb
            imageUrl={shown || null}
            name={productName ?? "Product"}
            className="h-28 w-28 rounded-xl sm:h-32 sm:w-32"
          />
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            {preview ? "New photo" : shown ? "Current" : "No photo"}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          {/* Drop zone doubles as the click target for the file input. */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!pending && !busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file && !pending && !busy) void handleFile(file);
            }}
            className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
              dragging
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-300 bg-slate-50"
            }`}
          >
            <p className="text-sm text-slate-600">
              Drag an image here, or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={pending || busy}
                className="font-semibold text-indigo-600 underline underline-offset-2 hover:text-indigo-500 disabled:opacity-50"
              >
                choose a file
              </button>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {PRODUCT_IMAGE_FORMAT_HINT}, up to {formatImageBytes(MAX_PRODUCT_IMAGE_BYTES)}.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={`${areaId}-url`}
              className="block text-xs font-semibold uppercase tracking-wide text-slate-600"
            >
              Or paste an image URL
            </label>
            <input
              id={`${areaId}-url`}
              name={name}
              type="url"
              inputMode="url"
              disabled={pending || busy}
              value={imageUrl}
              placeholder="https://… or /images/item.jpg"
              onChange={(e) => {
                setImageUrl(e.target.value);
                setPreview(null);
                onImageUrlChange?.(e.target.value || null);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </div>

          {/* Remove only applies to a stored photo; a staged-but-unsaved preview
              is simply discarded by picking a different file. */}
          {productId && imageUrl && !preview ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={pending || busy}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600 transition hover:text-rose-500 disabled:opacity-50"
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>

      <FormError>{busy ? "Working on the photo…" : error}</FormError>
    </div>
  );
}


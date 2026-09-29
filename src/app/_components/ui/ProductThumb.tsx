"use client";

import { useState } from "react";

/**
 * Product thumbnail with a generated fallback.
 *
 * Visual product recognition is the single biggest speed win on a retail POS
 * counter: a cashier reads the shelf, not the SKU. So every surface that shows
 * a product (the register's product grid, the inventory table) uses this one
 * component, and a product with no `imageUrl` still gets a clean, stable tile
 * rather than a blank gap or a broken-image glyph.
 *
 * The fallback is the product's initials on a slate panel, so the grid still
 * reads as a grid when photos are absent.
 *
 * Why a plain `<img>` and not `next/image`: this POS is self-hosted on a LAN
 * where images are usually served from an arbitrary host or a NAS share that
 * the Next image optimizer cannot reach. Direct browser fetch is the correct
 * call here, and it keeps the component usable from a Server Component caller
 * too — `next/image` would force `fill`/wrapper plumbing everywhere.
 *
 * A failed load swaps back to the fallback rather than leaving the browser's
 * broken-image icon sitting in the register's most prominent grid.
 */
export default function ProductThumb({
  imageUrl,
  name,
  size = "md",
  className = "",
}: {
  /** Stored product photo. Falsy (or null) renders the initials fallback. */
  imageUrl?: string | null;
  /** Used for the fallback initials and the alt text. */
  name: string;
  /** `sm` for table rows, `md` for the register grid. */
  size?: "sm" | "md";
  /** Extra classes on the outer frame (e.g. aspect ratio). */
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // A photo on a NAS can take a beat to arrive, and an image that pops in over a
  // blank slate is jarring on the register grid. Track load state so we can show
  // the initials underneath until the bytes are actually painted.
  const [loaded, setLoaded] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;
  // Reset the flags when the source changes, otherwise a replaced photo would
  // stay hidden waiting for a load event that already fired for the old one.
  const [seenUrl, setSeenUrl] = useState(imageUrl);
  if (imageUrl !== seenUrl) {
    setSeenUrl(imageUrl);
    setFailed(false);
    setLoaded(false);
  }

  const box =
    size === "sm"
      ? "h-10 w-10 rounded-lg text-[11px]"
      : "h-full w-full text-lg";

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-slate-100 ring-1 ring-inset ring-slate-200 ${box} ${className}`}
    >
      {/* Fallback sits underneath; a real image covers it. If the image later
          fails we hide it again, revealing this without a layout shift. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center font-bold uppercase tracking-wide text-slate-400"
      >
        {initials(name)}
      </span>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl as string}
          alt={name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </span>
  );
}

/** Up to two initials from a product name ("Aurora Wireless Headphones" -> "AW"). */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
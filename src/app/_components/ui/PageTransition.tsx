"use client";

import { type ReactNode } from "react";

/**
 * Simple page transition wrapper that fades in on mount.
 * Used at the top level of the dashboard layout so route changes
 * animate smoothly. The fade-in is driven purely by CSS (the
 * `animate-fade-in` utility applies `both` fill-mode), so there is no
 * client-side state/effect needed — it animates once on first paint.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
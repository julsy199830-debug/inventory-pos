import type { Config } from "tailwindcss";

/**
 * InvPos — Enterprise dark theme configuration.
 *
 * Tailwind v4 reads most of its configuration from `@import "tailwindcss"`
 * + `@theme` in `globals.css` (the authoritative token source), but we
 * register `content` here so the scanner resolves class names across the
 * project, and mirror the dark-theme semantic tokens for documentation.
 *
 * The dark convention used by every module:
 *   - page canvas ......... bg-slate-950   (alias: bg-surface)
 *   - card containers ..... bg-slate-900   (alias: bg-card)
 *   - hairline borders .... border-slate-800 /80 (alias: border-line)
 *   - headings ............ text-slate-100; body text slate-300/400
 *   - primary actions ..... bg-indigo-600 hover:bg-indigo-500 (active states
 *                           bg-indigo-600 text-white; violet for gradients)
 * Printable surfaces (.print-receipt / .print-report) stay light "paper" via
 * their own classes + the @media print rules in globals.css.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // JS mirror of the `@theme` semantic aliases in globals.css.
        surface: "#020617", // slate-950 — page canvas
        card: "#0f172a", // slate-900 — card containers
        line: "#1e293b", // slate-800 — hairline borders
        accent: {
          DEFAULT: "#6366f1", // indigo-500 — primary actions / active states
          soft: "#8b5cf6", // violet-500 — secondary accent / gradients
        },
      },
      borderRadius: {
        // Standardize the app on a single radius scale:
        // cards, dialogs & inputs use `xl`/`2xl`, compact controls use `lg`.
        lg: "0.625rem",
        xl: "0.875rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "pop-in": "pop-in 0.18s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;

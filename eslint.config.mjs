import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Underscore-prefixed names (e.g. `{ sales: _sales, ... }` used to strip
      // fields off an object before returning it) are intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
    },
  },
  // CommonJS harness files.
  //
  // `require()` is the only valid import syntax in a `.cjs` module, so the
  // TypeScript rule that bans it cannot apply here - there is no `import`
  // alternative that Node would load from a `.cjs` file. Scoped by extension
  // rather than by path so a future CommonJS helper is covered automatically,
  // and so nothing in `src/` is affected.
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local additions:
    ".claude/**", // git worktree copy — not part of this codebase
    "_smoke.js", // standalone CommonJS smoke script (deliberately uses require)
  ]),
]);

export default eslintConfig;

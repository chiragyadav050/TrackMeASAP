import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  globalIgnores([
    // Defaults from eslint-config-next.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma output: machine-written, thousands of lines, not ours to lint.
    "src/generated/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),

  ...nextVitals,
  ...nextTs,

  {
    rules: {
      // `_`-prefixed parameters are the convention for "required by the
      // signature, deliberately unused" (e.g. useActionState's prevState).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Rule 20 of the build brief: `any` needs a written justification, so
      // it must be an explicit, reviewable decision rather than a default.
      "@typescript-eslint/no-explicit-any": "error",
      // Floating promises are how "it silently didn't happen" bugs start.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  {
    // The logger is the one module whose job is writing to the console.
    files: ["src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },

  // Must stay last: turns off every stylistic rule Prettier owns.
  prettier,
]);

export default eslintConfig;

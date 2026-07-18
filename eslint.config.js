import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "No network calls outside the dictionary adapter (docs/SECURITY.md). Use the adapter seam.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='XMLHttpRequest']",
          message: "No network calls outside the dictionary adapter (docs/SECURITY.md).",
        },
        {
          selector: "NewExpression[callee.name='WebSocket']",
          message: "No network calls outside the dictionary adapter (docs/SECURITY.md).",
        },
      ],
    },
  },
  {
    // Sanctioned fetch seams: the local book:// protocol (not a network
    // call — served by our own Rust process) and, from M2, the explicit
    // opt-in online dictionary adapter.
    files: ["src/services/bookData.ts", "src/services/dictionary/online/**"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": "off",
    },
  },
);

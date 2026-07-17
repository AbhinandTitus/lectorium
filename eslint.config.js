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
    // The one sanctioned network seam (created in M2): explicit opt-in online dictionary.
    files: ["src/services/dictionary/online/**"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": "off",
    },
  },
);

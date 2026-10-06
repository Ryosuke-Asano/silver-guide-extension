import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "dist-chromium/**"] },
  {
    files: ["src/**/*.{ts,tsx}", "*.config.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended]
  }
);

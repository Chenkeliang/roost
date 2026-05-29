import tseslint from "typescript-eslint";
export default tseslint.config(
  // packages/web uses JSX/TSX and its own tsconfig — lint is handled by tsc --noEmit in that package
  { ignores: ["**/dist/**", "**/node_modules/**", "packages/web/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);

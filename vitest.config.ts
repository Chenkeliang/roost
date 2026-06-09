import { defineConfig, configDefaults } from "vitest/config";
// Root config runs core/cli/shared tests in the default (node) environment.
// The web package has its own jsdom config (pnpm --filter @roost/web test);
// exclude it here so node-env runs never pick up jsdom/window-dependent tests.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/web/**"],
  },
});

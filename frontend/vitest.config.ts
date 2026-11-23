import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Playwright runs e2e/ (pnpm e2e).
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
